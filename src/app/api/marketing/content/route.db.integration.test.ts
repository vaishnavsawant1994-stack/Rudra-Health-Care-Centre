import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("marketing content PostgreSQL lifecycle", () => {
  const { Pool } = pg;
  const schema = `p2_09a_marketing_content_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool>;
  let dropPool: InstanceType<typeof Pool> | undefined;
  let createHandler: typeof import("./route").POST;
  let listHandler: typeof import("./route").GET;
  let detailHandler: typeof import("./[id]/route").GET;
  let actionHandler: typeof import("./[id]/route").PATCH;
  let organizationId: string;
  let centreId: string;
  let creatorId: string;
  let reviewerId: string;
  const grants = [{ key: "marketing.read", centreId: "" }, { key: "marketing.manage", centreId: "" }];
  let activeStaffId = "";

  beforeAll(async () => {
    loadProjectEnvironment();
    testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) throw new Error("A dedicated PostgreSQL test database is required.");
    const admin = new Pool({ connectionString: testUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    await runMigrations(testUrl, null, schema);
    const scopedUrl = new URL(testUrl); scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`); process.env.DATABASE_URL = scopedUrl.toString();
    pool = new Pool({ connectionString: scopedUrl.toString(), max: 2 });
    organizationId = randomUUID(); centreId = randomUUID(); creatorId = randomUUID(); reviewerId = randomUUID();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `MC-${organizationId.slice(0, 8)}`, "Synthetic content test"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [centreId, organizationId, `C-${centreId.slice(0, 8)}`, "Synthetic Centre"]);
    for (const [staffId, label] of [[creatorId, "Creator"], [reviewerId, "Reviewer"]]) {
      const authId = randomUUID();
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authId, `Synthetic ${label}`, `${authId}@invalid.test`]);
      await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [staffId, authId, organizationId, `ST-${staffId.slice(0, 8)}`, `Synthetic ${label}`]);
    }
    grants[0].centreId = centreId; grants[1].centreId = centreId; activeStaffId = creatorId;
    mocks.getApiAccess.mockImplementation(async () => ({ staff: { organizationId, staffUserId: activeStaffId, grants }, response: null }));
    ({ POST: createHandler, GET: listHandler } = await import("./route"));
    ({ GET: detailHandler, PATCH: actionHandler } = await import("./[id]/route"));
  }, 60_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ }
    await pool?.end();
    if (testUrl) { dropPool = new Pool({ connectionString: testUrl, max: 1 }); await dropPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await dropPool.end(); }
    if (testUrl) process.env.DATABASE_URL = testUrl;
  }, 60_000);

  it("creates encrypted drafts, requires independent approval, schedules as planning only, and records history", async () => {
    const key = randomUUID();
    const payload = { centreId, channel: "SOCIAL", contentType: "POST", title: "Synthetic content title", body: "Synthetic marketing copy only", internalNote: "Synthetic internal note", idempotencyKey: key };
    const request = () => new Request("http://localhost/api/marketing/content", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(payload) });
    const createdResponse = await createHandler(request());
    expect(createdResponse.status).toBe(201);
    const created = await createdResponse.json() as { item: { id: string; status: string; versionNumber: number }; externalPublishing: string };
    expect(created.item.status).toBe("DRAFT"); expect(created.externalPublishing).toBe("DISABLED");
    const replay = await createHandler(request()); expect(replay.status).toBe(200);
    const stored = await pool.query("SELECT private_data_ciphertext,status FROM marketing_content_items WHERE id=$1", [created.item.id]);
    expect(stored.rows[0].private_data_ciphertext).not.toContain("Synthetic marketing copy");
    expect(stored.rows[0].status).toBe("DRAFT");

    const patch = (action: object, idemKey = randomUUID()) => actionHandler(new Request(`http://localhost/api/marketing/content/${created.item.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": idemKey }, body: JSON.stringify(action) }), { params: Promise.resolve({ id: created.item.id }) });
    let result = await patch({ action: "SUBMIT_REVIEW", expectedVersion: 1, reason: "Synthetic review submission" }); expect(result.status).toBe(200);
    result = await patch({ action: "APPROVE", expectedVersion: 2, reason: "Synthetic independent approval" }); expect(result.status).toBe(409); expect(await result.json()).toMatchObject({ error: "independent_review_required" });
    activeStaffId = reviewerId;
    result = await patch({ action: "APPROVE", expectedVersion: 2, reason: "Synthetic independent approval" }); expect(result.status).toBe(200);
    const plannedAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    result = await patch({ action: "SCHEDULE", expectedVersion: 3, plannedPublishAt: plannedAt, reason: "Synthetic calendar planning" }); expect(result.status).toBe(200);
    const scheduled = await result.json() as { item: { status: string; plannedPublishAt: string }; externalPublishing: string };
    expect(scheduled.item.status).toBe("SCHEDULED"); expect(scheduled.item.plannedPublishAt).toBe(plannedAt); expect(scheduled.externalPublishing).toBe("DISABLED");
    const list = await listHandler(new Request(`http://localhost/api/marketing/content?centreId=${centreId}&status=SCHEDULED`)); expect(list.status).toBe(200);
    const details = await detailHandler(new Request(`http://localhost/api/marketing/content/${created.item.id}`), { params: Promise.resolve({ id: created.item.id }) });
    const detail = await details.json() as { history: Array<{ eventType: string }> };
    expect(detail.history.map((event) => event.eventType)).toEqual(["SCHEDULED", "APPROVED", "SUBMITTED", "CREATED"]);
    expect(await pool.query("SELECT count(*)::int AS n FROM marketing_content_events WHERE content_item_id=$1", [created.item.id]).then((r) => r.rows[0].n)).toBe(4);
    await expect(pool.query("UPDATE marketing_content_events SET event_type='UPDATED' WHERE content_item_id=$1", [created.item.id])).rejects.toThrow();
  });
});
