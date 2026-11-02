import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("task approval policy inheritance PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_approval_policy_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool> | undefined;
  let handler: typeof import("./route").GET;
  let organizationId: string;
  let centreId: string;
  let staffUserId: string;

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

    organizationId = randomUUID();
    centreId = randomUUID();
    staffUserId = randomUUID();
    const authUserId = randomUUID();
    const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `AP-${seed}`, "Synthetic approval scope test"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [centreId, organizationId, `AP-${seed}`, "Synthetic approval centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authUserId, "Synthetic Centre Policy Manager", `${seed.toLowerCase()}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [staffUserId, authUserId, organizationId, `AP-${seed}`, "Synthetic Centre Policy Manager"]);
    mocks.getApiAccess.mockImplementation(async (_permission: string, requestedCentreId?: string) => requestedCentreId === centreId
      ? { response: null, staff: { organizationId, staffUserId, grants: [{ key: "tasks.policy.manage", centreId }] } }
      : { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null });
    ({ GET: handler } = await import("./route"));
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ }
    await pool?.end();
    if (testUrl) {
      const admin = new Pool({ connectionString: testUrl, max: 1 });
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    if (testUrl) process.env.DATABASE_URL = testUrl;
  }, 30_000);

  it("returns only the effective scope and never leaks organization named approvers", async () => {
    const organizationPolicyId = randomUUID();
    await pool!.query("INSERT INTO staff_approval_policies(id,organization_id,centre_id,action_type,enabled,approver_permission,version_number,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,NULL,'TASK_COMPLETION',true,'tasks.approve',1,$3,$3)", [organizationPolicyId, organizationId, staffUserId]);
    await pool!.query("INSERT INTO staff_approval_policy_approvers(id,organization_id,policy_id,staff_id,created_by_staff_id) VALUES($1,$2,$3,$4,$4)", [randomUUID(), organizationId, organizationPolicyId, staffUserId]);

    const inheritedResponse = await handler(new Request(`http://localhost/api/tasks/policy?centreId=${centreId}`));
    const inherited = await inheritedResponse.json() as { policy: unknown; effectivePolicy: { source: string; enabled: boolean }; eligibleApprovers: unknown[] };
    expect(inheritedResponse.status).toBe(200);
    expect(inherited.policy).toBeNull();
    expect(inherited.effectivePolicy).toEqual({ source: "ORGANIZATION", enabled: true });
    expect(JSON.stringify(inherited)).not.toContain(organizationPolicyId);
    expect(JSON.stringify(inherited)).not.toContain(staffUserId);

    const centrePolicyId = randomUUID();
    await pool!.query("INSERT INTO staff_approval_policies(id,organization_id,centre_id,action_type,enabled,approver_permission,version_number,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,$3,'TASK_COMPLETION',false,'tasks.approve',2,$4,$4)", [centrePolicyId, organizationId, centreId, staffUserId]);
    const overrideResponse = await handler(new Request(`http://localhost/api/tasks/policy?centreId=${centreId}`));
    const override = await overrideResponse.json() as { policy: { id: string; centreId: string; enabled: boolean }; effectivePolicy: { source: string; enabled: boolean } };
    expect(overrideResponse.status).toBe(200);
    expect(override.policy).toMatchObject({ id: centrePolicyId, centreId, enabled: false });
    expect(override.effectivePolicy).toEqual({ source: "CENTRE", enabled: false });
    expect(JSON.stringify(override)).not.toContain(organizationPolicyId);
  });
});
