import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";
import { encryptOperationalData, operationalContext } from "@/server/operational-crypto";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("escalation task reference PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_escalation_task_ref_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool> | undefined;
  let getReferences: typeof import("./route").GET;
  let resolveTaskReference: typeof import("@/server/task-reference").resolveTaskReference;
  let organizationId: string;
  let centreId: string;
  let staffUserId: string;
  let assignedEscalationId: string;
  let otherEscalationId: string;

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

    organizationId = randomUUID(); centreId = randomUUID(); staffUserId = randomUUID();
    assignedEscalationId = randomUUID(); otherEscalationId = randomUUID();
    const creatorId = randomUUID(); const authUserId = randomUUID(); const creatorAuthId = randomUUID();
    const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `ER-${seed}`, "Synthetic escalation task reference"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name) VALUES($1,$2,$3,$4)", [centreId, organizationId, `ER-${seed}`, "Synthetic escalation reference centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true),($4,$5,$6,true)', [authUserId, "Synthetic assigned escalation reader", `${seed.toLowerCase()}@invalid.test`, creatorAuthId, "Synthetic task creator", `creator-${seed.toLowerCase()}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false),($6,$7,$3,$8,$9,'ACTIVE',false)", [staffUserId, authUserId, organizationId, `ER-${seed}`, "Synthetic assigned escalation reader", creatorId, creatorAuthId, `EC-${seed}`, "Synthetic task creator"]);
    for (const [id, number, assigned] of [[assignedEscalationId, `RHC-E-${seed}-A`, staffUserId], [otherEscalationId, `RHC-E-${seed}-B`, creatorId]] as const) {
      const ciphertext = encryptOperationalData({ title: "Synthetic private title", description: "Synthetic private escalation detail" }, operationalContext({ organizationId, centreId, recordId: id }, "staff-escalation"));
      await pool.query("INSERT INTO staff_escalations(id,organization_id,centre_id,escalation_number,source_type,source_id,private_data_ciphertext,severity,priority,status,assigned_owner_staff_id,created_by_staff_id,due_at,idempotency_key,request_hash,version_number) VALUES($1,$2,$3,$4,'LEAD',$5,$6,'MODERATE','NORMAL','OPEN',$7,$8,now()+interval '1 hour',$9,$10,1)", [id, organizationId, centreId, number, randomUUID(), ciphertext, assigned, creatorId, randomUUID(), "a".repeat(64)]);
    }
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentreId?: string) => {
      if (requestedCentreId === centreId && permission === "escalations.assigned.read") return { response: null, staff: { organizationId, staffUserId, grants: [{ key: "escalations.assigned.read", centreId }] } };
      return { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null };
    });
    ({ GET: getReferences } = await import("./route"));
    ({ resolveTaskReference } = await import("@/server/task-reference"));
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ }
    await pool?.end();
    if (testUrl) { const admin = new Pool({ connectionString: testUrl, max: 1 }); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
    if (testUrl) process.env.DATABASE_URL = testUrl;
  }, 30_000);

  it("lists and resolves only assigned escalation records without exposing private text", async () => {
    const response = await getReferences(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=STAFF_ESCALATION`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.references).toEqual([{ id: assignedEscalationId, label: expect.stringContaining("RHC-E-") }]);
    expect(JSON.stringify(body)).not.toContain("Synthetic private");
    const staff = { organizationId, staffUserId, grants: [{ key: "escalations.assigned.read", centreId }] };
    expect(await resolveTaskReference(staff, centreId, { type: "STAFF_ESCALATION", id: assignedEscalationId })).toContain("RHC-E-");
    expect(await resolveTaskReference(staff, centreId, { type: "STAFF_ESCALATION", id: otherEscalationId })).toBeNull();
    expect(await resolveTaskReference(staff, randomUUID(), { type: "STAFF_ESCALATION", id: assignedEscalationId })).toBeNull();
  });
});
