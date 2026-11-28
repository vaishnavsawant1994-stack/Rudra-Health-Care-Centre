import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../scripts/migrate.mjs";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("Metropolis manual evidence isolated PostgreSQL concurrency", () => {
  const { Pool } = pg;
  const schema = `p2_09a_metropolis_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let previousDatabaseUrl: string | undefined;
  let pool: InstanceType<typeof Pool>;
  let postReference: typeof import("./references/route").POST;
  let postStatus: typeof import("./status/route").POST;
  let organizationId: string;
  let centreId: string;
  let otherCentreId: string;
  let staffId: string;
  let orderId: string;
  let otherOrderId: string;
  let denied = false;
  const syntheticEnv = ["RUDRA_BLIND_INDEX_KEY", "RUDRA_FIELD_ACTIVE_KEY_ID", "RUDRA_FIELD_ENCRYPTION_KEYS"] as const;
  const previousKeys = new Map<string, string | undefined>();

  beforeAll(async () => {
    loadProjectEnvironment();
    testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) throw new Error("A dedicated PostgreSQL test database is required.");
    previousDatabaseUrl = process.env.DATABASE_URL;
    for (const key of syntheticEnv) previousKeys.set(key, process.env[key]);
    process.env.RUDRA_BLIND_INDEX_KEY = Buffer.alloc(32, 41).toString("base64");
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "metropolis-test";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ "metropolis-test": Buffer.alloc(32, 73).toString("base64") });
    const admin = new Pool({ connectionString: testUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    await runMigrations(testUrl, null, schema);
    const scoped = new URL(testUrl);
    scoped.searchParams.set("options", `-csearch_path=${schema},public`);
    process.env.DATABASE_URL = scoped.toString();
    pool = new Pool({ connectionString: scoped.toString(), max: 2 });
    organizationId = randomUUID(); centreId = randomUUID(); otherCentreId = randomUUID(); staffId = randomUUID();
    const authId = randomUUID();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `MT-${organizationId.slice(0, 8)}`, "Synthetic integration test"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata'),($5,$2,$6,$7,'Asia/Kolkata')", [centreId, organizationId, `MC-${centreId.slice(0, 8)}`, "Synthetic Centre A", otherCentreId, `MC-${otherCentreId.slice(0, 8)}`, "Synthetic Centre B"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authId, "Synthetic Integration Staff", `${authId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',true)", [staffId, authId, organizationId, `MS-${staffId.slice(0, 8)}`, "Synthetic Integration Staff"]);
    const makeOrder = async (centre: string) => {
      const patientId = randomUUID(); const id = randomUUID();
      await pool.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,consent_recorded_at,consent_method,created_by_staff_id) VALUES($1,$2,$3,$4,'GRANTED',now(),'IN_PERSON',$5)", [patientId, organizationId, centre, `SYN-${patientId.slice(0, 8)}`, staffId]);
      await pool.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,'DRAFT',$6,$7,$8)", [id, organizationId, centre, `SO-${id.slice(0, 8)}`, patientId, randomUUID(), "a".repeat(64), staffId]);
      return id;
    };
    orderId = await makeOrder(centreId); otherOrderId = await makeOrder(otherCentreId);
    mocks.getApiAccess.mockImplementation(async (_permission: string, requestedCentre?: string) => denied || (requestedCentre && ![centreId, otherCentreId].includes(requestedCentre))
      ? { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) }
      : { response: null, staff: { organizationId, staffUserId: staffId, grants: [{ key: "samples.external.verify", centreId: null }] } });
    ({ POST: postReference } = await import("./references/route"));
    ({ POST: postStatus } = await import("./status/route"));
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ }
    await pool?.end();
    if (testUrl) { const admin = new Pool({ connectionString: testUrl, max: 1 }); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = previousDatabaseUrl;
    for (const key of syntheticEnv) { const value = previousKeys.get(key); if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }, 30_000);

  const request = (url: string, body: unknown, key = randomUUID()) => new Request(`http://localhost${url}`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });
  const mappingBody = (externalReference: string, targetOrder = orderId, targetCentre = centreId) => ({ centreId: targetCentre, orderId: targetOrder, referenceType: "ORDER", externalReference, evidenceReference: "SYNTHETIC-EVIDENCE-01", reason: "Synthetic manual reconciliation evidence" });

  it("serializes concurrent same-key mapping retries and rejects cross-centre reference collisions", async () => {
    const key = randomUUID(); const same = mappingBody(`SYN-MAP-${randomUUID()}`);
    const replay = await Promise.all([postReference(request("/api/metropolis/references", same, key)), postReference(request("/api/metropolis/references", same, key))]);
    expect(replay.map(r => r.status).sort()).toEqual([200, 201]);
    const reference = `SYN-COLLISION-${randomUUID()}`;
    const collision = await Promise.all([postReference(request("/api/metropolis/references", mappingBody(reference))), postReference(request("/api/metropolis/references", mappingBody(reference, otherOrderId, otherCentreId)))]);
    expect(collision.map(r => r.status).sort()).toEqual([201, 409]);
    expect((await pool.query("SELECT count(*)::int AS n FROM metropolis_reference_mappings WHERE organization_id=$1 AND reference_blind_index=(SELECT reference_blind_index FROM metropolis_reference_mappings WHERE organization_id=$1 ORDER BY created_at DESC LIMIT 1)", [organizationId])).rows).toHaveLength(1);
  });

  it("replays concurrent status submissions, rejects changed occurrence times, and preserves single append-only corrections", async () => {
    const externalReference = `SYN-STATUS-${randomUUID()}`;
    await postReference(request("/api/metropolis/references", mappingBody(externalReference)));
    const occurredAt = "2026-11-14T08:00:00.000Z";
    const statusBody = { action: "record", orderId, statusCode: "SAMPLE_RECEIVED", occurredAt, externalReference, evidenceReference: "SYNTHETIC-STATUS-EVIDENCE", reason: "Synthetic status statement" };
    const key = randomUUID();
    const records = await Promise.all([postStatus(request("/api/metropolis/status", statusBody, key)), postStatus(request("/api/metropolis/status", statusBody, key))]);
    expect(records.map(r => r.status).sort()).toEqual([200, 201]);
    const event = (await records.find(r => r.status === 201)!.json()).event as { id: string };
    const changed = await postStatus(request("/api/metropolis/status", { ...statusBody, occurredAt: "2026-11-14T08:01:00.000Z" }, key));
    expect(changed.status).toBe(409);
    const correction = { ...statusBody, statusCode: "SAMPLE_REGISTERED", supersedesEventId: event.id };
    const corrected = await Promise.all([postStatus(request("/api/metropolis/status", correction)), postStatus(request("/api/metropolis/status", correction))]);
    expect(corrected.filter(r => r.status === 201)).toHaveLength(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM metropolis_status_events WHERE supersedes_event_id=$1", [event.id])).rows[0].n).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS n FROM audit_events WHERE organization_id=$1 AND action LIKE 'metropolis.status_%'", [organizationId])).rows[0].n).toBeGreaterThanOrEqual(2);
  });

  it("enforces centre authorization, staff-only source and append-only tables", async () => {
    denied = true;
    const deniedResponse = await postReference(request("/api/metropolis/references", mappingBody(`SYN-DENIED-${randomUUID()}`)));
    denied = false;
    expect(deniedResponse.status).toBe(403);
    await expect(pool.query("UPDATE metropolis_reference_mappings SET private_data_ciphertext='tampered' WHERE organization_id=$1", [organizationId])).rejects.toThrow(/append-only/i);
    const statusColumns = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='metropolis_status_events'", [schema]);
    expect(statusColumns.rows.map((row: { column_name: string }) => row.column_name)).not.toContain("provider_confirmed");
  });
});
