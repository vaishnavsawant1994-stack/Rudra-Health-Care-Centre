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
  let patchJobHandler: typeof import("./[id]/route").PATCH;
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
    ({ PATCH: patchJobHandler } = await import("./[id]/route"));
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
      if (assignedStaffId) await pool!.query("INSERT INTO collection_job_events(id,organization_id,centre_id,job_id,event_type,source,private_data_ciphertext,staff_id,actor_staff_id) VALUES($1,$2,$3,$4,'ASSIGNED','STAFF','synthetic assignment fixture',$5,$6)", [randomUUID(), organizationId, jobCentreId, jobId, assignedStaffId, fieldStaffId]);
      return { id: jobId, jobNumber };
    };

    const permittedJob = await insertJob(centreId, fieldStaffId, "SELF", "2099-01-05T05:00:00.000Z");
    permittedJobNumber = permittedJob.jobNumber;
    coworkerJobNumber = (await insertJob(centreId, otherStaffId, "OTHER", "2099-01-05T05:30:00.000Z")).jobNumber;
    unassignedJobNumber = (await insertJob(centreId, null, "NONE", "2099-01-05T06:00:00.000Z")).jobNumber;
    otherCentreJobNumber = (await insertJob(otherCentreId, fieldStaffId, "CENTRE", "2099-01-05T06:30:00.000Z")).jobNumber;

    const response = await getHandler(new Request("http://localhost/api/collections?assignedToMe=1&date=2099-01-05&pageSize=100"));
    expect(response.status).toBe(200);
    const body = await response.json() as { jobs: Array<{ jobNumber: string; patientName: string; patientLastName: string }> };
    expect(body.jobs.map((job) => job.jobNumber)).toEqual([permittedJobNumber]);
    expect(body.jobs[0]).toMatchObject({ patientName: "Synthetic", patientLastName: "Route SELF" });
    const serialized = JSON.stringify(body);
    for (const privateJobNumber of [coworkerJobNumber, unassignedJobNumber, otherCentreJobNumber]) expect(serialized).not.toContain(privateJobNumber);

    const directStartResponse = await patchJobHandler(new Request(`http://localhost/api/collections/${permittedJob.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "start", expectedVersion: 1, reason: "Synthetic visit started" }) }), { params: Promise.resolve({ id: permittedJob.id }) });
    expect(directStartResponse.status).toBe(409);
    expect(await directStartResponse.json()).toEqual({ error: "assignment_acceptance_required" });
    const acceptanceKey = randomUUID();
    const accept = (reason = "Synthetic collector accepted assignment") => new Request(`http://localhost/api/collections/${permittedJob.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": acceptanceKey }, body: JSON.stringify({ action: "accept", expectedVersion: 1, reason }) });
    const acceptanceResponse = await patchJobHandler(accept(), { params: Promise.resolve({ id: permittedJob.id }) });
    expect(acceptanceResponse.status).toBe(200);
    expect(await acceptanceResponse.json()).toMatchObject({ job: { status: "ASSIGNED", versionNumber: 2 }, replayed: false });
    expect(await (await patchJobHandler(accept(), { params: Promise.resolve({ id: permittedJob.id }) })).json()).toMatchObject({ replayed: true });
    expect(await (await patchJobHandler(accept("Changed acceptance reason"), { params: Promise.resolve({ id: permittedJob.id }) })).json()).toEqual({ error: "idempotency_conflict" });
    const startedJobResponse = await patchJobHandler(new Request(`http://localhost/api/collections/${permittedJob.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "start", expectedVersion: 2, reason: "Synthetic visit started" }) }), { params: Promise.resolve({ id: permittedJob.id }) });
    expect(startedJobResponse.status).toBe(200);
    expect(await startedJobResponse.json()).toMatchObject({ job: { status: "IN_PROGRESS", versionNumber: 3 } });
    const delayedJobResponse = await patchJobHandler(new Request(`http://localhost/api/collections/${permittedJob.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "delay", expectedVersion: 3, reason: "Synthetic traffic delay", estimatedArrivalAt: "2099-01-05T05:20:00.000Z" }) }), { params: Promise.resolve({ id: permittedJob.id }) });
    expect(delayedJobResponse.status).toBe(200);
    expect(await delayedJobResponse.json()).toMatchObject({ job: { status: "IN_PROGRESS", versionNumber: 4 } });
    const travellingQueueResponse = await getHandler(new Request("http://localhost/api/collections?assignedToMe=1&date=2099-01-05&pageSize=100"));
    expect(await travellingQueueResponse.json()).toMatchObject({ jobs: [{ status: "IN_PROGRESS", visitStage: "TRAVELLING" }], summary: { byVisitStage: { travelling: 1, arrived: 0 } } });
    const arrivedResponse = await patchJobHandler(new Request(`http://localhost/api/collections/${permittedJob.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "arrive", expectedVersion: 4, reason: "Synthetic field worker arrival" }) }), { params: Promise.resolve({ id: permittedJob.id }) });
    expect(arrivedResponse.status).toBe(200);
    const arrivedQueueResponse = await getHandler(new Request("http://localhost/api/collections?assignedToMe=1&date=2099-01-05&pageSize=100"));
    expect(await arrivedQueueResponse.json()).toMatchObject({ jobs: [{ status: "IN_PROGRESS", visitStage: "ARRIVED" }], summary: { byVisitStage: { travelling: 0, arrived: 1 } } });
    const delayEvent = await pool!.query("SELECT event_type FROM collection_job_events WHERE job_id=$1 ORDER BY recorded_at", [permittedJob.id]);
    expect(delayEvent.rows.map((row) => row.event_type)).toEqual(["ASSIGNED", "ASSIGNMENT_ACCEPTED", "TRAVEL_STARTED", "VISIT_DELAYED", "ARRIVED"]);

    const declinableJob = await insertJob(centreId, fieldStaffId, "DECLINE", "2099-01-05T07:00:00.000Z");
    const requestBody = { action: "decline", expectedVersion: 1, reason: "Synthetic schedule conflict" };
    const coworkerRequest = new Request(`http://localhost/api/collections/${declinableJob.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "decline", expectedVersion: 1, reason: "Unauthorized synthetic decline" }) });
    const coworkerAccess = async () => ({ response: null, staff: { organizationId, staffUserId: otherStaffId, grants: [{ key: "collections.assign", centreId }, { key: "collections.visit.record", centreId }] } });
    mocks.getApiAccess.mockImplementationOnce(coworkerAccess).mockImplementationOnce(coworkerAccess);
    const unauthorized = await patchJobHandler(coworkerRequest, { params: Promise.resolve({ id: declinableJob.id }) });
    expect(unauthorized.status).toBe(404);
    expect((await pool!.query("SELECT status,assigned_staff_id FROM collection_jobs WHERE id=$1", [declinableJob.id])).rows[0]).toEqual({ status: "ASSIGNED", assigned_staff_id: fieldStaffId });

    const idempotencyKey = randomUUID();
    const request = (reason = requestBody.reason) => new Request(`http://localhost/api/collections/${declinableJob.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ ...requestBody, reason }) });
    const firstRequest = request();
    const declineResponse = await patchJobHandler(firstRequest, { params: Promise.resolve({ id: declinableJob.id }) });
    expect(declineResponse.status).toBe(200);
    expect(await declineResponse.json()).toMatchObject({ job: { id: declinableJob.id, status: "PENDING_ASSIGNMENT", versionNumber: 2 }, replayed: false });
    const persisted = await pool!.query("SELECT status,assigned_staff_id FROM collection_jobs WHERE id=$1", [declinableJob.id]);
    expect(persisted.rows[0]).toEqual({ status: "PENDING_ASSIGNMENT", assigned_staff_id: null });
    const event = await pool!.query("SELECT id,event_type,previous_staff_id,private_data_ciphertext FROM collection_job_events WHERE job_id=$1 ORDER BY recorded_at,id", [declinableJob.id]);
    expect(event.rows).toHaveLength(2);
    expect(event.rows[1].event_type).toBe("ASSIGNMENT_DECLINED");
    expect(event.rows[1].previous_staff_id).toBe(fieldStaffId);
    expect(event.rows[1].private_data_ciphertext).not.toContain(requestBody.reason);
    const { decryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    expect(decryptOperationalData<{ reason: string }>(event.rows[1].private_data_ciphertext, operationalContext({ organizationId, centreId, recordId: event.rows[1].id }, "collection-job-event")).reason).toBe(requestBody.reason);
    const replay = await patchJobHandler(request(), { params: Promise.resolve({ id: declinableJob.id }) });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ job: { status: "PENDING_ASSIGNMENT", versionNumber: 2 }, replayed: true });
    const conflict = await patchJobHandler(request("Different synthetic reason"), { params: Promise.resolve({ id: declinableJob.id }) });
    expect(conflict.status).toBe(409);
    expect((await pool!.query("SELECT count(*)::int AS count FROM collection_job_events WHERE job_id=$1", [declinableJob.id])).rows[0].count).toBe(2);
    const postDeclineCoworkerRequest = new Request(`http://localhost/api/collections/${declinableJob.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "decline", expectedVersion: 2, reason: "Unauthorized synthetic replay" }) });
    mocks.getApiAccess.mockImplementationOnce(coworkerAccess).mockImplementationOnce(coworkerAccess);
    const postDeclineUnauthorized = await patchJobHandler(postDeclineCoworkerRequest, { params: Promise.resolve({ id: declinableJob.id }) });
    expect(postDeclineUnauthorized.status).toBe(404);

  });
});
