import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../scripts/load-project-env.mjs";
import { runMigrations } from "../../scripts/migrate.mjs";
import { encryptOperationalData, operationalContext } from "@/server/operational-crypto";

const { Pool } = pg;

describe("task approval deadline worker PostgreSQL integration", () => {
  const schema = `p2_09a_approval_worker_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const originalTestDatabaseUrl = process.env.DATABASE_TEST_URL;
  let testUrl = "";
  let pool: InstanceType<typeof Pool> | undefined;
  let worker: typeof import("@/server/approval-deadline-worker").processDueTaskApprovalDeadlines;
  let organizationId: string;
  let centreId: string;
  let otherCentreId: string;
  let creatorId: string;
  let assigneeId: string;
  let approverId: string;

  async function createStaff(displayName: string, suffix: string) {
    const staffId = randomUUID();
    const authUserId = randomUUID();
    await pool!.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authUserId, displayName, `${suffix}@invalid.test`]);
    await pool!.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [staffId, authUserId, organizationId, `AW-${staffId.slice(0, 8)}`, displayName]);
    return staffId;
  }

  async function createDueTask(input: { id?: string; centreId?: string; assignedStaffId?: string; createdByStaffId?: string; escalationOwnerStaffId?: string | null; approvalExpiresAt: Date | null; escalationDueAt: Date | null }) {
    const id = input.id ?? randomUUID();
    const centre = input.centreId ?? centreId;
    await pool!.query(
      `INSERT INTO staff_tasks
        (id, organization_id, centre_id, task_number, private_data_ciphertext, task_type, status,
         requires_approval, approval_status, assigned_staff_id, created_by_staff_id,
         approval_expires_at, escalation_owner_staff_id, escalation_due_at,
         idempotency_key, request_hash)
       VALUES ($1,$2,$3,$4,$5,'GENERAL','AWAITING_APPROVAL',true,'PENDING',$6,$7,$8,$9,$10,$11,$12)`,
      [id, organizationId, centre, `AW-${id.slice(0, 12)}`, encryptOperationalData({ title: "Synthetic task", description: "" }, operationalContext({ organizationId, centreId: centre, recordId: id }, "staff-task")), input.assignedStaffId ?? assigneeId, input.createdByStaffId ?? creatorId, input.approvalExpiresAt, input.escalationOwnerStaffId ?? null, input.escalationDueAt, randomUUID(), "a".repeat(64)],
    );
    return id;
  }

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
    pool = new Pool({ connectionString: scopedUrl.toString(), max: 1 });

    organizationId = randomUUID();
    centreId = randomUUID();
    otherCentreId = randomUUID();
    const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `AW-${seed}`, "Synthetic approval worker test"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata'),($5,$2,$6,$7,'Asia/Kolkata')", [centreId, organizationId, `AW-${seed}`, "Synthetic approval centre", otherCentreId, `AWX-${seed}`, "Synthetic other centre"]);
    creatorId = await createStaff("Synthetic approval task creator", `${seed.toLowerCase()}-creator`);
    assigneeId = await createStaff("Synthetic approval task assignee", `${seed.toLowerCase()}-assignee`);
    approverId = await createStaff("Synthetic independent approver", `${seed.toLowerCase()}-approver`);
    const roleId = randomUUID();
    await pool.query("INSERT INTO roles(id,organization_id,key,name,scope,is_system) VALUES($1,$2,$3,$4,'CENTRE',false)", [roleId, organizationId, `aw_${seed.toLowerCase()}`, "Synthetic approval worker role"]);
    for (const [key, description] of [["tasks.approve", "Synthetic task approval permission"], ["tasks.read", "Synthetic task read permission"]]) {
      await pool.query("INSERT INTO permissions(id,key,description,scope) VALUES($1,$2,$3,'CENTRE') ON CONFLICT(key) DO NOTHING", [randomUUID(), key, description]);
    }
    await pool.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key=ANY($2::varchar[]) ON CONFLICT DO NOTHING", [roleId, ["tasks.approve", "tasks.read"]]);
    await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, approverId, roleId, centreId]);
    ({ processDueTaskApprovalDeadlines: worker } = await import("@/server/approval-deadline-worker"));
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ }
    await pool?.end();
    if (testUrl) {
      const admin = new Pool({ connectionString: testUrl, max: 1 });
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl;
    if (originalTestDatabaseUrl === undefined) delete process.env.DATABASE_TEST_URL; else process.env.DATABASE_TEST_URL = originalTestDatabaseUrl;
  }, 30_000);

  it("expires due approvals exactly once and preserves an append-only system event", async () => {
    const now = new Date("2035-03-04T10:00:00.000Z");
    const taskId = await createDueTask({ approvalExpiresAt: new Date(now.getTime() - 60_000), escalationDueAt: new Date(now.getTime() - 120_000), escalationOwnerStaffId: approverId });

    const first = await worker(20, now, { organizationId, centreIds: [centreId] });
    const replay = await worker(20, now, { organizationId, centreIds: [centreId] });
    const task = await pool!.query("SELECT status,approval_status,version_number FROM staff_tasks WHERE id=$1 AND organization_id=$2", [taskId, organizationId]);
    const events = await pool!.query("SELECT event_type,actor_type,actor_staff_id FROM staff_task_events WHERE task_id=$1 AND organization_id=$2", [taskId, organizationId]);
    const audit = await pool!.query("SELECT action,actor_staff_id FROM audit_events WHERE entity_type='staff_task' AND entity_id=$1 AND organization_id=$2", [taskId, organizationId]);

    expect(first).toMatchObject({ processed: 1, expired: 1, escalated: 0 });
    expect(replay).toMatchObject({ processed: 0, expired: 0, escalated: 0 });
    expect(task.rows).toMatchObject([{ status: "IN_PROGRESS", approval_status: "EXPIRED", version_number: 2 }]);
    expect(events.rows).toMatchObject([{ event_type: "APPROVAL_EXPIRED", actor_type: "SYSTEM", actor_staff_id: null }]);
    expect(audit.rows).toMatchObject([{ action: "staff_task.approval_expired", actor_staff_id: null }]);
  });

  it("processes an eligible escalation once and skips invalid owners and tasks outside centre scope", async () => {
    const now = new Date("2035-03-04T10:00:00.000Z");
    const eligibleTaskId = await createDueTask({ approvalExpiresAt: new Date(now.getTime() + 60_000), escalationDueAt: new Date(now.getTime() - 60_000), escalationOwnerStaffId: approverId });
    const invalidOwnerTaskId = await createDueTask({ approvalExpiresAt: new Date(now.getTime() + 60_000), escalationDueAt: new Date(now.getTime() - 60_000), escalationOwnerStaffId: assigneeId });
    const otherCentreTaskId = await createDueTask({ centreId: otherCentreId, approvalExpiresAt: new Date(now.getTime() + 60_000), escalationDueAt: new Date(now.getTime() - 60_000), escalationOwnerStaffId: approverId });

    const first = await worker(20, now, { organizationId, centreIds: [centreId] });
    const replay = await worker(20, now, { organizationId, centreIds: [centreId] });
    const eligible = await pool!.query("SELECT escalation_processed_at,version_number FROM staff_tasks WHERE id=$1", [eligibleTaskId]);
    const invalid = await pool!.query("SELECT escalation_processed_at,approval_status FROM staff_tasks WHERE id=$1", [invalidOwnerTaskId]);
    const outOfScope = await pool!.query("SELECT escalation_processed_at FROM staff_tasks WHERE id=$1", [otherCentreTaskId]);
    const events = await pool!.query("SELECT event_type,actor_type FROM staff_task_events WHERE task_id=$1", [eligibleTaskId]);

    expect(first).toMatchObject({ processed: 1, expired: 0, escalated: 1, skippedInvalidOwner: 1 });
    expect(replay).toMatchObject({ processed: 0, expired: 0, escalated: 0 });
    expect(eligible.rows[0].escalation_processed_at).not.toBeNull();
    expect(eligible.rows[0].version_number).toBe(2);
    expect(invalid.rows[0]).toMatchObject({ escalation_processed_at: null, approval_status: "PENDING" });
    expect(outOfScope.rows[0].escalation_processed_at).toBeNull();
    expect(events.rows).toMatchObject([{ event_type: "ESCALATED", actor_type: "SYSTEM" }]);
  });

  it("serializes concurrent deadline runs so a single approval produces one expiry event", async () => {
    const now = new Date("2035-03-04T10:00:00.000Z");
    const taskId = await createDueTask({ approvalExpiresAt: new Date(now.getTime() - 60_000), escalationDueAt: null });

    const results = await Promise.all([
      worker(20, now, { organizationId, centreIds: [centreId] }),
      worker(20, now, { organizationId, centreIds: [centreId] }),
    ]);
    const task = await pool!.query("SELECT status,approval_status,version_number FROM staff_tasks WHERE id=$1 AND organization_id=$2", [taskId, organizationId]);
    const events = await pool!.query("SELECT event_type FROM staff_task_events WHERE task_id=$1 AND organization_id=$2", [taskId, organizationId]);

    expect(results.reduce((total, result) => total + result.processed, 0)).toBe(1);
    expect(results.reduce((total, result) => total + result.expired, 0)).toBe(1);
    expect(task.rows).toMatchObject([{ status: "IN_PROGRESS", approval_status: "EXPIRED", version_number: 2 }]);
    expect(events.rows).toMatchObject([{ event_type: "APPROVAL_EXPIRED" }]);
    expect(events.rows).toHaveLength(1);
  });
});
