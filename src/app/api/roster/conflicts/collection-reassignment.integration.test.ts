import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";
import { encryptOperationalData, operationalContext } from "@/server/operational-crypto";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("roster collection-conflict reassignment PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_collection_reassign_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool> | undefined;
  let conflictsHandler: typeof import("./route").GET;
  let collectionPatch: typeof import("../../collections/[id]/route").PATCH;
  let organizationId: string;
  let centreId: string;
  let managerId: string;
  let collectorId: string;

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

    organizationId = randomUUID(); centreId = randomUUID(); managerId = randomUUID(); collectorId = randomUUID();
    const managerAuthId = randomUUID(); const collectorAuthId = randomUUID(); const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `CR-${seed}`, "Synthetic collection reassignment"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [centreId, organizationId, `CR-${seed}`, "Synthetic collection centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true),($4,$5,$6,true)', [managerAuthId, "Synthetic roster manager", seed.toLowerCase() + "@invalid.test", collectorAuthId, "Synthetic collector", seed.toLowerCase() + "-collector@invalid.test"]);
    await pool.query('INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,$10,$11),($6,$7,$3,$8,$9,$10,$11)', [managerId, managerAuthId, organizationId, "RM-" + seed, "Synthetic roster manager", collectorId, collectorAuthId, "PC-" + seed, "Synthetic collector", "ACTIVE", false]);

    const collectorRoleId = randomUUID();
    await pool.query("INSERT INTO roles(id,organization_id,key,name,scope) VALUES($1,$2,$3,$4,'CENTRE')", [collectorRoleId, organizationId, `collector_${seed.toLowerCase()}`, "Synthetic collection role"]);
    await pool.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key='collections.visit.record'", [collectorRoleId]);
    await pool.query("INSERT INTO staff_role_assignments(id,organization_id,staff_user_id,role_id,centre_id,assigned_by_staff_id) VALUES($1,$2,$3,$4,$5,$6)", [randomUUID(), organizationId, collectorId, collectorRoleId, centreId, managerId]);

    const grants = [
      { key: "roster.read", centreId }, { key: "roster.manage", centreId },
      { key: "collections.read", centreId }, { key: "collections.assign", centreId },
    ];
    mocks.getApiAccess.mockImplementation(async (_permission: string, requestedCentreId?: string) => {
      if (requestedCentreId === undefined || requestedCentreId === centreId) return { response: null, staff: { organizationId, staffUserId: managerId, grants } };
      return { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null };
    });
    ({ GET: conflictsHandler } = await import("./route"));
    ({ PATCH: collectionPatch } = await import("../../collections/[id]/route"));
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ }
    await pool?.end();
    if (testUrl) {
      const admin = new Pool({ connectionString: testUrl, max: 1 });
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
      process.env.DATABASE_URL = testUrl;
    }
  }, 30_000);

  it("reassigns an unavailable collector's job and clears the advisory with durable history", async () => {
    const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    const patientId = randomUUID(); const appointmentId = randomUUID(); const orderId = randomUUID(); const collectionId = randomUUID();
    const start = new Date("2026-11-10T08:00:00.000Z");
    const from = new Date(start.getTime() - 60 * 60_000).toISOString();
    const to = new Date(start.getTime() + 2 * 60 * 60_000).toISOString();
    const appointmentCiphertext = encryptOperationalData(
      { homeCollectionAddress: { line1: "Synthetic address", city: "Synthetic city" }, collectionInstructions: null, communicationEvidenceReference: null, homeChargeReason: null },
      operationalContext({ organizationId, centreId, recordId: appointmentId }, "appointment"),
    );
    await pool!.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',$5)", [patientId, organizationId, centreId, `SYN-${seed}`, managerId]);
    await pool!.query(
      "INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,booking_source,visit_type,scheduled_at,duration_minutes,time_zone,status,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'STAFF','HOME_COLLECTION',$6,30,'Asia/Kolkata','CONFIRMED',$7,$8,$9,$10)",
      [appointmentId, organizationId, centreId, `RA-${seed}`, patientId, start, appointmentCiphertext, managerId, randomUUID(), "a".repeat(64)],
    );
    await pool!.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [orderId, organizationId, centreId, `RO-${seed}`, patientId, appointmentId, randomUUID(), "b".repeat(64), managerId]);
    await pool!.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,assigned_staff_id,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'ASSIGNED',$8,$9,$10,$11,$12)", [collectionId, organizationId, centreId, `CJ-${seed}`, appointmentId, orderId, patientId, managerId, start, new Date(start.getTime() + 45 * 60_000), randomUUID(), managerId]);
    await pool!.query("INSERT INTO staff_shifts(id,organization_id,centre_id,staff_id,shift_type,status,starts_at,ends_at,time_zone,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'UNAVAILABLE','ACTIVE',$5,$6,'Asia/Kolkata','synthetic-ciphertext',$4,$7,$8)", [randomUUID(), organizationId, centreId, managerId, new Date(start.getTime() - 15 * 60_000), new Date(start.getTime() + 60 * 60_000), randomUUID(), "c".repeat(64)]);
    await pool!.query("INSERT INTO staff_shifts(id,organization_id,centre_id,staff_id,shift_type,status,starts_at,ends_at,time_zone,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'SCHEDULED','ACTIVE',$5,$6,'Asia/Kolkata','synthetic-ciphertext',$7,$8,$9)", [randomUUID(), organizationId, centreId, collectorId, new Date(start.getTime() - 30 * 60_000), new Date(start.getTime() + 60 * 60_000), managerId, randomUUID(), "d".repeat(64)]);

    const beforeResponse = await conflictsHandler(new Request(`http://localhost/api/roster/conflicts?centreId=${centreId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
    const before = await beforeResponse.json() as { conflicts: Array<{ id: string; kind: string; advisoryFlags: string[] }> };
    expect(beforeResponse.status).toBe(200);
    expect(before.conflicts.find((item) => item.id === collectionId)).toMatchObject({ kind: "COLLECTION", advisoryFlags: expect.arrayContaining(["DURING_UNAVAILABILITY"]) });

    const [current] = (await pool!.query("SELECT version_number FROM collection_jobs WHERE id=$1", [collectionId])).rows;
    const reassigned = await collectionPatch(new Request(`http://localhost/api/collections/${collectionId}`, {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ expectedVersion: current.version_number, action: "assign", staffUserId: collectorId, reason: "Synthetic roster availability reassignment" }),
    }), { params: Promise.resolve({ id: collectionId }) });
    expect(reassigned.status).toBe(200);
    expect(await reassigned.json()).toMatchObject({ job: { id: collectionId, status: "ASSIGNED", versionNumber: current.version_number + 1 }, replayed: false });

    const persisted = await pool!.query("SELECT assigned_staff_id,status,version_number FROM collection_jobs WHERE id=$1", [collectionId]);
    const history = await pool!.query("SELECT event_type,staff_id,previous_staff_id,actor_staff_id FROM collection_job_events WHERE job_id=$1", [collectionId]);
    expect(persisted.rows[0]).toEqual({ assigned_staff_id: collectorId, status: "ASSIGNED", version_number: current.version_number + 1 });
    expect(history.rows).toEqual([{ event_type: "REASSIGNED", staff_id: collectorId, previous_staff_id: managerId, actor_staff_id: managerId }]);

    const afterResponse = await conflictsHandler(new Request(`http://localhost/api/roster/conflicts?centreId=${centreId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
    const after = await afterResponse.json() as { conflicts: Array<{ id: string }> };
    expect(afterResponse.status).toBe(200);
    expect(after.conflicts.map((item) => item.id)).not.toContain(collectionId);
  });
});
