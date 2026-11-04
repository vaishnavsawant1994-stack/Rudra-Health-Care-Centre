import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("roster workload PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_roster_workload_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let previousDatabaseUrl: string | undefined;
  let pool: InstanceType<typeof Pool> | undefined;
  let handler: typeof import("./route").GET;
  let organizationId: string;
  let centreId: string;
  let otherCentreId: string;
  let managerId: string;
  let peerId: string;
  let accessMode: "TEAM" | "SELF" = "TEAM";

  beforeAll(async () => {
    loadProjectEnvironment();
    testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) {
      throw new Error("A dedicated test database is required.");
    }
    previousDatabaseUrl = process.env.DATABASE_URL;
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
    managerId = randomUUID();
    peerId = randomUUID();
    const managerAuthId = randomUUID();
    const peerAuthId = randomUUID();
    const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();

    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `RW-${seed}`, "Synthetic workload test"]);
    await pool.query(
      "INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata'),($5,$2,$6,$7,'Asia/Kolkata')",
      [centreId, organizationId, `RW-${seed}`, "Synthetic workload centre", otherCentreId, `RWO-${seed}`, "Synthetic other centre"],
    );
    await pool.query(
      'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true),($4,$5,$6,true)',
      [managerAuthId, "Synthetic Manager", `${seed.toLowerCase()}@invalid.test`, peerAuthId, "Synthetic Staff", `${seed.toLowerCase()}-peer@invalid.test`],
    );
    await pool.query(
      "INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false),($6,$7,$3,$8,$9,'ACTIVE',false)",
      [managerId, managerAuthId, organizationId, `RM-${seed}`, "Synthetic Manager", peerId, peerAuthId, `RS-${seed}`, "Synthetic Staff"],
    );
    const roleId = randomUUID();
    await pool.query("INSERT INTO roles(id,organization_id,key,name,scope) VALUES($1,$2,$3,$4,'CENTRE')", [roleId, organizationId, `workload_${seed.toLowerCase()}`, "Synthetic Workload Role"]);
    await pool.query(
      "INSERT INTO staff_role_assignments(id,organization_id,staff_user_id,role_id,centre_id,assigned_by_staff_id) VALUES($1,$2,$3,$4,$5,$3),($6,$2,$7,$4,$5,$3)",
      [randomUUID(), organizationId, managerId, roleId, centreId, randomUUID(), peerId],
    );

    const teamGrants = [{ key: "roster.read", centreId }, { key: "roster.manage", centreId }];
    const selfGrants = [{ key: "roster.read", centreId }];
    mocks.getApiAccess.mockImplementation(async (_permission: string, requestedCentreId?: string) => {
      if (requestedCentreId === centreId) {
        return {
          response: null,
          staff: { organizationId, staffUserId: managerId, grants: accessMode === "TEAM" ? teamGrants : selfGrants },
        };
      }
      return { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null };
    });
    ({ GET: handler } = await import("./route"));
  }, 120_000);

  afterAll(async () => {
    try {
      const { closeDatabasePool } = await import("@/db/client");
      await closeDatabasePool();
    } catch { /* database pool may not have initialized */ }
    await pool?.end();
    if (testUrl) {
      const admin = new Pool({ connectionString: testUrl, max: 1 });
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }, 30_000);

  it("returns centre workload to team readers and only the caller's workload to self readers", async () => {
    const dayStart = new Date("2026-11-05T08:00:00.000Z");
    const dayEnd = new Date("2026-11-05T09:00:00.000Z");
    const appointmentIds = [randomUUID(), randomUUID()];
    const patientIds = [randomUUID(), randomUUID()];
    const patientNumbers = patientIds.map(() => `SYN-${randomUUID().slice(0, 8)}`);

    for (let index = 0; index < patientIds.length; index += 1) {
      await pool!.query(
        "INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',$5)",
        [patientIds[index], organizationId, centreId, patientNumbers[index], managerId],
      );
    }
    for (const [index, assignee] of [managerId, peerId].entries()) {
      await pool!.query(
        "INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,booking_source,visit_type,scheduled_at,duration_minutes,time_zone,status,assigned_staff_id,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'STAFF','CENTRE',$6,30,'Asia/Kolkata','CONFIRMED',$7,'synthetic-ciphertext',$8,$9,$10)",
        [appointmentIds[index], organizationId, centreId, `RW-A-${randomUUID().slice(0, 8)}`, patientIds[index], dayStart, assignee, managerId, randomUUID(), "a".repeat(64)],
      );
    }

    const orderIds = [randomUUID(), randomUUID()];
    const collectionIds = [randomUUID(), randomUUID()];
    for (const index of [0, 1]) {
      await pool!.query(
        "INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)",
        [orderIds[index], organizationId, centreId, `RW-O-${randomUUID().slice(0, 8)}`, patientIds[index], appointmentIds[index], randomUUID(), "b".repeat(64), managerId],
      );
      await pool!.query(
        "INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,assigned_staff_id,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'ASSIGNED',$8,$9,$10,$11,$12)",
        [collectionIds[index], organizationId, centreId, `RW-C-${randomUUID().slice(0, 8)}`, appointmentIds[index], orderIds[index], patientIds[index], index === 0 ? managerId : peerId, dayStart, dayEnd, randomUUID(), managerId],
      );
    }

    await pool!.query(
      "INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash,due_at) VALUES($1,$2,$3,$4,'synthetic-ciphertext','GENERAL','NORMAL','OPEN',$5,$6,$7,$8,$9)",
      [randomUUID(), organizationId, centreId, `RW-T-${randomUUID().slice(0, 8)}`, peerId, managerId, randomUUID(), "c".repeat(64), dayEnd],
    );

    await pool!.query(
      "INSERT INTO staff_shifts(id,organization_id,centre_id,staff_id,shift_type,status,starts_at,ends_at,time_zone,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'SCHEDULED','ACTIVE',$5,$6,'Asia/Kolkata','synthetic-ciphertext',$4,$7,$8),($9,$2,$3,$10,'UNAVAILABLE','ACTIVE',$5,$6,'Asia/Kolkata','synthetic-ciphertext',$4,$11,$12)",
      [randomUUID(), organizationId, centreId, managerId, new Date("2026-11-05T07:00:00.000Z"), new Date("2026-11-05T10:00:00.000Z"), randomUUID(), "d".repeat(64), randomUUID(), peerId, randomUUID(), "e".repeat(64)],
    );

    const query = `centreId=${centreId}&from=${encodeURIComponent(dayStart.toISOString())}&to=${encodeURIComponent(dayEnd.toISOString())}`;
    const teamResponse = await handler(new Request(`http://localhost/api/roster/workload?${query}`));
    const team = await teamResponse.json() as {
      staff: Array<{ id: string; name: string; appointments: number; collections: number; openTasks: number; scheduledMinutes: number; assignmentsDuringUnavailability: number }>;
      dailyWorkload: Array<{ staffId: string; day: string; appointments: number; collections: number }>;
    };
    expect(teamResponse.status).toBe(200);
    expect(team.staff.map(({ id }) => id)).toEqual(expect.arrayContaining([managerId, peerId]));
    expect(team.staff.find(({ id }) => id === managerId)).toMatchObject({ appointments: 1, collections: 1, scheduledMinutes: 60 });
    expect(team.staff.find(({ id }) => id === peerId)).toMatchObject({ appointments: 1, collections: 1, openTasks: 1, unavailablePeriods: 1, assignmentsDuringUnavailability: 2 });
    expect(team.dailyWorkload).toEqual(expect.arrayContaining([
      { staffId: managerId, day: "2026-11-05", appointments: 1, collections: 1 },
      { staffId: peerId, day: "2026-11-05", appointments: 1, collections: 1 },
    ]));
    const serializedTeam = JSON.stringify(team);
    expect(serializedTeam).not.toContain(patientNumbers[0]);
    expect(serializedTeam).not.toContain(patientNumbers[1]);
    expect(serializedTeam).not.toContain("synthetic-ciphertext");

    accessMode = "SELF";
    const selfResponse = await handler(new Request(`http://localhost/api/roster/workload?${query}`));
    const self = await selfResponse.json() as { staff: Array<{ id: string; name: string }>; dailyWorkload: Array<{ staffId: string }> };
    expect(selfResponse.status).toBe(200);
    expect(self.staff.map(({ id }) => id)).toEqual([managerId]);
    expect(self.dailyWorkload.map(({ staffId }) => staffId)).toEqual([managerId]);
    expect(JSON.stringify(self)).not.toContain("Synthetic Staff");

    const denied = await handler(new Request(`http://localhost/api/roster/workload?centreId=${otherCentreId}&from=${encodeURIComponent(dayStart.toISOString())}&to=${encodeURIComponent(dayEnd.toISOString())}`));
    expect(denied.status).toBe(403);
  });
});
