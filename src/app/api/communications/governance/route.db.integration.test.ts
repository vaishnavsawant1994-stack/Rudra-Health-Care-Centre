import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("communications governance draft PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_comm_governance_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool>;
  let getHandler: typeof import("./route").GET;
  let postHandler: typeof import("./route").POST;
  let patchHandler: typeof import("./[id]/route").PATCH;
  let organizationId: string;
  let centreId: string;
  let otherCentreId: string;
  let staffUserId: string;

  beforeAll(async () => {
    loadProjectEnvironment();
    testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) throw new Error("A dedicated PostgreSQL test database is required.");
    const admin = new Pool({ connectionString: testUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    await runMigrations(testUrl, null, schema);
    const scopedUrl = new URL(testUrl);
    scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
    process.env.DATABASE_URL = scopedUrl.toString();
    pool = new Pool({ connectionString: scopedUrl.toString(), max: 2 });
    organizationId = randomUUID(); centreId = randomUUID(); otherCentreId = randomUUID(); staffUserId = randomUUID();
    const authId = randomUUID();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `CG-${organizationId.slice(0, 8)}`, "Synthetic communications governance"]);
    for (const id of [centreId, otherCentreId]) await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [id, organizationId, `C-${id.slice(0, 8)}`, "Synthetic Centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authId, "Synthetic config admin", `${authId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',true)", [staffUserId, authId, organizationId, `ST-${staffUserId.slice(0, 8)}`, "Synthetic config admin"]);
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => ({ staff: { organizationId, staffUserId, grants: [{ key: "configuration.read", centreId }, { key: "configuration.manage", centreId }] }, response: requestedCentre === otherCentreId ? Response.json({ error: "forbidden" }, { status: 403 }) : permission === "configuration.manage" || requestedCentre === centreId ? null : Response.json({ error: "forbidden" }, { status: 403 }) }));
    ({ GET: getHandler, POST: postHandler } = await import("./route"));
    ({ PATCH: patchHandler } = await import("./[id]/route"));
  }, 90_000);

  afterAll(async () => {
    await pool?.end();
    const { closeDatabasePool } = await import("@/db/client");
    await closeDatabasePool();
    if (testUrl) {
      const admin = new Pool({ connectionString: testUrl, max: 1 });
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    if (testUrl) process.env.DATABASE_URL = testUrl;
  }, 60_000);

  it("persists encrypted scoped drafts, versions updates, and keeps delivery/publication disabled", async () => {
    const idempotencyKey = randomUUID();
    const privateData = { displayName: "Synthetic centre WhatsApp policy", languages: ["en", "hi"], quietHoursStart: "21:00", quietHoursEnd: "09:00", routingInstructions: "Escalate to authorized reception staff for human review.", consentRequired: true, humanEscalation: true };
    const requestBody = { centreId, recordKind: "PROVIDER_POLICY", channel: "WHATSAPP", privateData, idempotencyKey };
    const createdResponse = await postHandler(new Request("http://localhost/api/communications/governance", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(requestBody) }));
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { record: { id: string; versionNumber: number; status: string; privateData: typeof privateData }; delivery: string; publication: string };
    expect(created).toMatchObject({ record: { versionNumber: 1, status: "DRAFT", privateData }, delivery: "DISABLED", publication: "DISABLED" });
    const stored = await pool.query("SELECT private_data_ciphertext FROM communication_governance_records WHERE id=$1", [created.record.id]);
    expect(stored.rows[0].private_data_ciphertext).not.toContain("Synthetic centre WhatsApp policy");
    expect(stored.rows[0].private_data_ciphertext).not.toContain("routingInstructions");

    const replayResponse = await postHandler(new Request("http://localhost/api/communications/governance", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(requestBody) }));
    expect(replayResponse.status).toBe(200);
    expect((await replayResponse.json() as { replayed: boolean }).replayed).toBe(true);

    const changed = { ...privateData, routingInstructions: "Use the approved staff queue for a consent-checked human follow-up." };
    const updateRequest = { centreId, recordKind: "PROVIDER_POLICY", channel: "WHATSAPP", expectedVersion: 1, privateData: changed };
    const patchKey = randomUUID();
    const patch = () => patchHandler(new Request(`http://localhost/api/communications/governance/${created.record.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": patchKey }, body: JSON.stringify(updateRequest) }), { params: Promise.resolve({ id: created.record.id }) });
    const updateResponse = await patch();
    expect(updateResponse.status).toBe(200);
    expect(await updateResponse.json()).toMatchObject({ record: { versionNumber: 2, status: "DRAFT", privateData: changed }, delivery: "DISABLED", publication: "DISABLED" });
    expect((await patch()).status).toBe(200);

    mocks.getApiAccess.mockImplementation(async (_permission: string, requestedCentre?: string) => ({ staff: { organizationId, staffUserId, grants: [{ key: "configuration.read", centreId }] }, response: requestedCentre === otherCentreId ? Response.json({ error: "forbidden" }, { status: 403 }) : null }));
    const denied = await getHandler(new Request(`http://localhost/api/communications/governance?centreId=${otherCentreId}&recordKind=PROVIDER_POLICY`));
    expect(denied.status).toBe(403);
    const listed = await getHandler(new Request(`http://localhost/api/communications/governance?centreId=${centreId}&recordKind=PROVIDER_POLICY`));
    expect(listed.status).toBe(200);
    const listing = await listed.json() as { records: Array<{ id: string }>; history: Array<{ eventType: string }> };
    expect(listing.records.map((record) => record.id)).toEqual([created.record.id]);
    expect(listing.history.map((event) => event.eventType)).toEqual(["UPDATED", "CREATED"]);
    expect(JSON.stringify(listing)).not.toContain(otherCentreId);
  }, 60_000);
});
