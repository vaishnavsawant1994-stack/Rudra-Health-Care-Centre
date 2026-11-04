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
  let putHandler: typeof import("./route").PUT;
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
    ({ GET: handler, PUT: putHandler } = await import("./route"));
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

  it("persists policy updates, safely replays idempotency, rejects stale writers and ineligible approvers", async () => {
    const approverId = randomUUID(); const approverAuthId = randomUUID(); const roleId = randomUUID();
    await pool!.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [approverAuthId, "Synthetic Eligible Approver", `${approverAuthId}@invalid.test`]);
    await pool!.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [approverId, approverAuthId, organizationId, `AP-${approverId.slice(0, 8)}`, "Synthetic Eligible Approver"]);
    await pool!.query("INSERT INTO roles(id,organization_id,key,name,scope,is_system) VALUES($1,$2,$3,$4,'CENTRE',false)", [roleId, organizationId, `approval_${roleId.slice(0, 8)}`, "Synthetic approval role"]);
    for (const [key, description] of [["tasks.approve", "Synthetic task approval permission"], ["tasks.read", "Synthetic task read permission"]]) await pool!.query("INSERT INTO permissions(id,key,description,scope) VALUES($1,$2,$3,'CENTRE') ON CONFLICT(key) DO NOTHING", [randomUUID(), key, description]);
    await pool!.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key=ANY($2::varchar[]) ON CONFLICT DO NOTHING", [roleId, ["tasks.approve", "tasks.read"]]);
    await pool!.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, approverId, roleId, centreId]);

    const current = await pool!.query("SELECT version_number FROM staff_approval_policies WHERE organization_id=$1 AND centre_id=$2 AND action_type='TASK_COMPLETION'", [organizationId, centreId]);
    const version = current.rows[0]?.version_number ?? 0;
    const input = { centreId, actionType: "TASK_COMPLETION", enabled: true, approverStaffIds: [approverId], escalationAfterMinutes: null, escalationOwnerStaffId: null, expireAfterMinutes: 120, expectedVersion: version };
    const key = randomUUID();
    const request = (body: typeof input, idempotencyKey = key) => new Request("http://localhost/api/tasks/policy", { method: "PUT", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify(body) });
    const first = await putHandler(request(input));
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ policy: { enabled: true, approverStaffIds: [approverId], expireAfterMinutes: 120, versionNumber: version + 1, replayed: false } });

    const replay = await putHandler(request(input));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ policy: { versionNumber: version + 1, replayed: true } });

    const competing = await Promise.all([
      putHandler(request({ ...input, enabled: false, expectedVersion: version + 1 }, randomUUID())),
      putHandler(request({ ...input, expireAfterMinutes: 180, expectedVersion: version + 1 }, randomUUID())),
    ]);
    expect(competing.map((response) => response.status).sort()).toEqual([200, 409]);
    const persisted = await pool!.query("SELECT enabled,expire_after_minutes,version_number FROM staff_approval_policies WHERE organization_id=$1 AND centre_id=$2 AND action_type='TASK_COMPLETION'", [organizationId, centreId]);
    expect(persisted.rows[0].version_number).toBe(version + 2);
    const approvers = await pool!.query("SELECT staff_id FROM staff_approval_policy_approvers WHERE organization_id=$1 AND policy_id=(SELECT id FROM staff_approval_policies WHERE organization_id=$1 AND centre_id=$2 AND action_type='TASK_COMPLETION')", [organizationId, centreId]);
    expect(approvers.rows.map((row) => row.staff_id)).toEqual([approverId]);

    const unqualifiedId = randomUUID(); const unqualifiedAuthId = randomUUID(); const approvalOnlyRoleId = randomUUID();
    await pool!.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [unqualifiedAuthId, "Synthetic Approval-Only Staff", `${unqualifiedAuthId}@invalid.test`]);
    await pool!.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [unqualifiedId, unqualifiedAuthId, organizationId, `AO-${unqualifiedId.slice(0, 8)}`, "Synthetic Approval-Only Staff"]);
    await pool!.query("INSERT INTO roles(id,organization_id,key,name,scope,is_system) VALUES($1,$2,$3,$4,'CENTRE',false)", [approvalOnlyRoleId, organizationId, `approval_only_${approvalOnlyRoleId.slice(0, 8)}`, "Synthetic approval-only role"]);
    const approvePermission = await pool!.query("SELECT id FROM permissions WHERE key='tasks.approve'");
    await pool!.query("INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [approvalOnlyRoleId, approvePermission.rows[0].id]);
    await pool!.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, unqualifiedId, approvalOnlyRoleId, centreId]);
    const denied = await putHandler(request({ ...input, approverStaffIds: [unqualifiedId], expectedVersion: version + 2 }, randomUUID()));
    expect(denied.status).toBe(400);
    expect(await denied.json()).toMatchObject({ error: "approver_not_eligible" });
    const audit = await pool!.query("SELECT action FROM audit_events WHERE organization_id=$1 AND entity_type='staff_approval_policy' ORDER BY sequence", [organizationId]);
    expect(audit.rows).toHaveLength(2);
  });
});
