import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { escalationActionFingerprint } from "@/server/escalation-request-fingerprint";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/server/task-reference", () => ({ resolveTaskReference: vi.fn(async () => "Synthetic lead reference") }));

describe("escalation action replay authorization PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_escalation_replay_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool> | undefined;
  let patch: typeof import("./route").PATCH;
  let organizationId: string;
  let centreId: string;
  let staffUserId: string;
  let assignedStaffId: string;
  let escalationId: string;
  let commentEscalationId: string;
  let idempotencyKey: string;
  let requestHash: string;

  beforeAll(async () => {
    loadProjectEnvironment();
    testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) throw new Error("A dedicated test database is required.");
    const admin = new Pool({ connectionString: testUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    await runMigrations(testUrl, null, schema);
    const scopedUrl = new URL(testUrl);
    scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
    process.env.DATABASE_URL = scopedUrl.toString();
    pool = new Pool({ connectionString: scopedUrl.toString(), max: 1 });

    organizationId = randomUUID(); centreId = randomUUID(); staffUserId = randomUUID(); assignedStaffId = randomUUID(); escalationId = randomUUID(); commentEscalationId = randomUUID(); idempotencyKey = randomUUID();
    const authUserId = randomUUID(); const eventId = randomUUID(); const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    const requestBody = { action: "UPDATE", expectedVersion: 1, severity: "HIGH", reason: "Synthetic replay check" };
    requestHash = escalationActionFingerprint(escalationId, requestBody);
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `ER-${seed}`, "Synthetic escalation replay test"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name) VALUES($1,$2,$3,$4)", [centreId, organizationId, `ER-${seed}`, "Synthetic replay centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authUserId, "Synthetic read-only escalation user", `${seed.toLowerCase()}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [staffUserId, authUserId, organizationId, `ER-${seed}`, "Synthetic read-only escalation user"]);
    const assignedAuthUserId = randomUUID();
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [assignedAuthUserId, "Synthetic assigned owner", `assigned-${seed.toLowerCase()}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [assignedStaffId, assignedAuthUserId, organizationId, `AS-${seed}`, "Synthetic assigned owner"]);

    const escalationCiphertext = encryptOperationalData({ title: "Synthetic escalation", description: "Synthetic escalation replay authorization test." }, operationalContext({ organizationId, centreId, recordId: escalationId }, "staff-escalation"));
    await pool.query("INSERT INTO staff_escalations(id,organization_id,centre_id,escalation_number,source_type,source_id,private_data_ciphertext,severity,priority,status,assigned_owner_staff_id,created_by_staff_id,due_at,idempotency_key,request_hash,version_number) VALUES($1,$2,$3,$4,'LEAD',$5,$6,'HIGH','NORMAL','OPEN',$7,$7,now()+interval '1 hour',$8,$9,2)", [escalationId, organizationId, centreId, `RHC-E-${seed}`, randomUUID(), escalationCiphertext, staffUserId, randomUUID(), "a".repeat(64)]);
    const commentEscalationCiphertext = encryptOperationalData({ title: "Preserve source title", description: "Original escalation description" }, operationalContext({ organizationId, centreId, recordId: commentEscalationId }, "staff-escalation"));
    await pool.query("INSERT INTO staff_escalations(id,organization_id,centre_id,escalation_number,source_type,source_id,private_data_ciphertext,severity,priority,status,assigned_owner_staff_id,created_by_staff_id,due_at,idempotency_key,request_hash,version_number) VALUES($1,$2,$3,$4,'LEAD',$5,$6,'MODERATE','NORMAL','OPEN',$7,$7,now()+interval '1 hour',$8,$9,1)", [commentEscalationId, organizationId, centreId, `RHC-E-C-${seed}`, randomUUID(), commentEscalationCiphertext, staffUserId, randomUUID(), "b".repeat(64)]);
    const eventCiphertext = encryptOperationalData({ reason: "Synthetic replay check", comment: null, assignedOwnerStaffId: assignedStaffId, severity: "HIGH", result: { status: "OPEN", versionNumber: 2 } }, operationalContext({ organizationId, centreId, recordId: eventId }, "staff-escalation-event"));
    await pool.query("INSERT INTO staff_escalation_events(id,organization_id,centre_id,escalation_id,event_type,private_data_ciphertext,actor_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'UPDATED',$5,$6,$7,$8)", [eventId, organizationId, centreId, escalationId, eventCiphertext, staffUserId, idempotencyKey, requestHash]);

    mocks.getApiAccess.mockImplementation(async (permission: string) => permission === "escalations.read"
      ? { staff: { organizationId, staffUserId, grants: [{ key: "escalations.read", centreId }] }, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    ({ PATCH: patch } = await import("./route"));
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ }
    await pool?.end();
    if (testUrl) { const admin = new Pool({ connectionString: testUrl, max: 1 }); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
    if (testUrl) process.env.DATABASE_URL = testUrl;
  }, 30_000);

  it("denies a read-only replay before returning the saved action result or changing the record", async () => {
    const request = new Request(`http://localhost/api/escalations/${escalationId}`, {
      method: "PATCH",
      headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify({ action: "UPDATE", expectedVersion: 1, severity: "HIGH", reason: "Synthetic replay check" }),
    });
    const response = await patch(request, { params: Promise.resolve({ id: escalationId }) });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    const unchanged = await pool!.query("SELECT status,version_number FROM staff_escalations WHERE id=$1 AND organization_id=$2", [escalationId, organizationId]);
    expect(unchanged.rows).toEqual([{ status: "OPEN", version_number: 2 }]);
    const event = await pool!.query("SELECT count(*)::int AS count FROM staff_escalation_events WHERE escalation_id=$1 AND idempotency_key=$2", [escalationId, idempotencyKey]);
    expect(event.rows[0].count).toBe(1);
  });

  it("returns human-readable assignment history without raw staff or organization identifiers", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request(`http://localhost/api/escalations/${escalationId}`), { params: Promise.resolve({ id: escalationId }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.escalation).not.toHaveProperty("organizationId");
    expect(body.escalation).not.toHaveProperty("createdByStaffId");
    expect(body.escalation).not.toHaveProperty("resolvedByStaffId");
    expect(body.escalation).not.toHaveProperty("assignedOwnerStaffId");
    expect(body.history).toHaveLength(1);
    expect(body.history[0]).toMatchObject({ actorName: "Synthetic read-only escalation user", assignedOwnerName: expect.stringMatching(/^Synthetic assigned owner \(AS-/), reason: "Synthetic replay check" });
    expect(body.history[0]).not.toHaveProperty("actorStaffId");
    expect(body.history[0]).not.toHaveProperty("assignedOwnerStaffId");
    expect(JSON.stringify(body)).not.toContain(assignedStaffId);
    expect(JSON.stringify(body)).not.toContain(organizationId);
  });

  it("keeps staff UUIDs out of the escalation queue projection", async () => {
    const { GET } = await import("../route");
    const response = await GET(new Request(`http://localhost/api/escalations?centreId=${centreId}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.escalations).toHaveLength(2);
    expect(body.escalations.some((item: { escalationNumber: string }) => /^RHC-E-C-/.test(item.escalationNumber))).toBe(true);
    expect(body.escalations.every((item: { ownerName: string }) => item.ownerName === "Synthetic read-only escalation user")).toBe(true);
    expect(body.escalations.every((item: Record<string, unknown>) => !Object.hasOwn(item, "assignedOwnerStaffId"))).toBe(true);
    expect(JSON.stringify(body)).not.toContain(staffUserId);
    expect(JSON.stringify(body)).not.toContain(assignedStaffId);
    expect(JSON.stringify(body)).not.toContain(organizationId);
  });

  it("filters escalation queues by severity and priority in PostgreSQL", async () => {
    const { GET } = await import("../route");
    const severityResponse = await GET(new Request(`http://localhost/api/escalations?centreId=${centreId}&severity=HIGH`));
    expect(severityResponse.status).toBe(200);
    const severityBody = await severityResponse.json();
    expect(severityBody.escalations).toHaveLength(1);
    expect(severityBody.escalations[0].severity).toBe("HIGH");

    const priorityResponse = await GET(new Request(`http://localhost/api/escalations?centreId=${centreId}&priority=URGENT`));
    expect(priorityResponse.status).toBe(200);
    expect((await priorityResponse.json()).escalations).toHaveLength(0);
  });

  it("keeps comments in encrypted append-only history without rewriting the escalation description", async () => {
    const comment = "Synthetic comment kept as a separate history event.";
    const key = randomUUID();
    const response = await patch(new Request(`http://localhost/api/escalations/${commentEscalationId}`, {
      method: "PATCH",
      headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ action: "COMMENT", expectedVersion: 1, comment }),
    }), { params: Promise.resolve({ id: commentEscalationId }) });
    expect(response.status).toBe(200);

    const [stored] = (await pool!.query("SELECT private_data_ciphertext,version_number FROM staff_escalations WHERE id=$1 AND organization_id=$2", [commentEscalationId, organizationId])).rows;
    expect(stored.version_number).toBe(2);
    const original = decryptOperationalData<{ title: string; description: string }>(stored.private_data_ciphertext, operationalContext({ organizationId, centreId, recordId: commentEscalationId }, "staff-escalation"));
    expect(original).toEqual({ title: "Preserve source title", description: "Original escalation description" });

    const { GET } = await import("./route");
    const historyResponse = await GET(new Request(`http://localhost/api/escalations/${commentEscalationId}`), { params: Promise.resolve({ id: commentEscalationId }) });
    expect(historyResponse.status).toBe(200);
    const body = await historyResponse.json();
    expect(body.escalation).toMatchObject({ title: "Preserve source title", description: "Original escalation description" });
    expect(body.history).toHaveLength(1);
    expect(body.history[0]).toMatchObject({ eventType: "COMMENTED", comment });
  });
});
