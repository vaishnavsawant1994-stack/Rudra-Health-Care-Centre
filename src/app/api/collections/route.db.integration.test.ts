import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../scripts/migrate.mjs";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("personal collection route PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_field_route_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let previousDatabaseUrl: string | undefined;
  let pool: InstanceType<typeof Pool> | undefined;
  let getHandler: typeof import("./route").GET;
  let organizationId: string;
  let centreId: string;
  let otherCentreId: string;
  let fieldStaffId: string;
  let otherStaffId: string;
  let permittedJobNumber = "";
  let coworkerJobNumber = "";
  let unassignedJobNumber = "";
  let otherCentreJobNumber = "";

  beforeAll(async () => {
    loadProjectEnvironment();
    testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) throw new Error("A dedicated PostgreSQL test database is required.");
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
    fieldStaffId = randomUUID();
    otherStaffId = randomUUID();
    const fieldAuthId = randomUUID();
    const otherAuthId = randomUUID();
    const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `FR-${seed}`, "Synthetic field route test"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata'),($5,$2,$6,$7,'Asia/Kolkata')", [centreId, organizationId, `FR-${seed}`, "Synthetic permitted centre", otherCentreId, `FX-${seed}`, "Synthetic restricted centre"]);
    await pool.query(`INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true),($4,$5,$6,true)`, [fieldAuthId, "Synthetic field worker", `${seed.toLowerCase()}@invalid.test`, otherAuthId, "Synthetic coworker", `${seed.toLowerCase()}-other@invalid.test`]);
    await pool.query(`INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false),($6,$7,$3,$8,$9,'ACTIVE',false)`, [fieldStaffId, fieldAuthId, organizationId, `FR-${seed}`, "Synthetic field worker", otherStaffId, otherAuthId, `FO-${seed}`, "Synthetic coworker"]);

    mocks.getApiAccess.mockImplementation(async (_permission: string, requestedCentreId?: string) => {
      if (requestedCentreId && requestedCentreId !== centreId) return { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) };
      return { response: null, staff: { organizationId, staffUserId: fieldStaffId, grants: [{ key: "collections.read", centreId }, { key: "collections.assign", centreId }] } };
    });
    ({ GET: getHandler } = await import("./route"));
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ }
    await pool?.end();
    if (testUrl) {
      const admin = new Pool({ connectionString: testUrl, max: 1 });
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }, 30_000);

  it("keeps the personal route self-assigned under broad centre collection permissions", async () => {
    const insertJob = async (jobCentreId: string, assignedStaffId: string | null, suffix: string, start: string) => {
      const patientId = randomUUID();
      const appointmentId = randomUUID();
      const orderId = randomUUID();
      const jobId = randomUUID();
      const context = { organizationId, centreId: jobCentreId, patientId };
      const { encryptPatientContacts, encryptPatientIdentity } = await import("@/server/patient-contact-crypto");
      const contacts = encryptPatientContacts({ phone: `900000${patientId.slice(0, 4)}`, email: null, profile: { preferredName: null, dateOfBirth: "1990-01-01", sexAtRegistration: null, address: null } }, context);
      const identity = encryptPatientIdentity({ firstName: "Synthetic", lastName: `Route ${suffix}` }, context);
      await pool!.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',$5)", [patientId, organizationId, jobCentreId, `SYN-${patientId.slice(0, 8)}`, fieldStaffId]);
      await pool!.query("INSERT INTO patient_contact_secrets(patient_id,organization_id,centre_id,encryption_key_id,phone_ciphertext,email_ciphertext,profile_ciphertext,name_ciphertext,phone_blind_index,email_blind_index,first_name_blind_index,last_name_blind_index,full_name_blind_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [patientId, organizationId, jobCentreId, contacts.encryptionKeyId, contacts.phoneCiphertext, contacts.emailCiphertext, contacts.profileCiphertext, identity.nameCiphertext, contacts.phoneBlindIndex, contacts.emailBlindIndex, identity.firstNameBlindIndex, identity.lastNameBlindIndex, identity.fullNameBlindIndex]);
      await pool!.query("INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,booking_source,visit_type,scheduled_at,duration_minutes,time_zone,status,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'STAFF','HOME_COLLECTION',$6,30,'Asia/Kolkata','CONFIRMED','synthetic-private-appointment',$7,$8,$9)", [appointmentId, organizationId, jobCentreId, `A-${appointmentId.slice(0, 8)}`, patientId, start, fieldStaffId, randomUUID(), "a".repeat(64)]);
      await pool!.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [orderId, organizationId, jobCentreId, `O-${orderId.slice(0, 8)}`, patientId, appointmentId, randomUUID(), "b".repeat(64), fieldStaffId]);
      const jobNumber = `J-${suffix}-${jobId.slice(0, 8)}`;
      await pool!.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,assigned_staff_id,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,CASE WHEN $8::uuid IS NULL THEN 'PENDING_ASSIGNMENT' ELSE 'ASSIGNED' END,$8,$9,$10,$11,$12)", [jobId, organizationId, jobCentreId, jobNumber, appointmentId, orderId, patientId, assignedStaffId, start, new Date(new Date(start).getTime() + 30 * 60_000).toISOString(), randomUUID(), fieldStaffId]);
      return jobNumber;
    };

    permittedJobNumber = await insertJob(centreId, fieldStaffId, "SELF", "2099-01-05T05:00:00.000Z");
    coworkerJobNumber = await insertJob(centreId, otherStaffId, "OTHER", "2099-01-05T05:30:00.000Z");
    unassignedJobNumber = await insertJob(centreId, null, "NONE", "2099-01-05T06:00:00.000Z");
    otherCentreJobNumber = await insertJob(otherCentreId, fieldStaffId, "CENTRE", "2099-01-05T06:30:00.000Z");

    const response = await getHandler(new Request("http://localhost/api/collections?assignedToMe=1&date=2099-01-05&pageSize=100"));
    expect(response.status).toBe(200);
    const body = await response.json() as { jobs: Array<{ jobNumber: string; patientName: string; patientLastName: string }> };
    expect(body.jobs.map((job) => job.jobNumber)).toEqual([permittedJobNumber]);
    expect(body.jobs[0]).toMatchObject({ patientName: "Synthetic", patientLastName: "Route SELF" });
    const serialized = JSON.stringify(body);
    for (const privateJobNumber of [coworkerJobNumber, unassignedJobNumber, otherCentreJobNumber]) expect(serialized).not.toContain(privateJobNumber);
  });
});
