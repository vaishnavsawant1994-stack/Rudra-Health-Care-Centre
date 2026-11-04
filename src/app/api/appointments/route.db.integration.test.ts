import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { sql } from "drizzle-orm";
import { loadProjectEnvironment } from "../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../scripts/migrate.mjs";
import { sealBusinessRelationship } from "@/server/business-relationship-data";
import { sealDoctorData } from "@/server/doctor-data";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getAppointmentReadAccess: vi.fn(), listAssignableAppointmentStaff: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/server/appointment-access", () => ({ getAppointmentReadAccess: mocks.getAppointmentReadAccess, listAssignableAppointmentStaff: mocks.listAssignableAppointmentStaff, mayReadAppointmentAt: () => true }));

describe("appointment creation PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_appointment_api_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool>;
  let dropPool: InstanceType<typeof Pool> | undefined;
  let handler: typeof import("./route").POST;
  let patientCreateHandler: typeof import("../patients/route").POST;
  let readHandler: typeof import("./[id]/route").GET;
  let updateHandler: typeof import("./[id]/route").PATCH;
  let searchHandler: typeof import("./search/route").POST;
  let checkInHandler: typeof import("./[id]/check-in/route").POST;
  let queueHandler: typeof import("./queue/route").GET;
  let queueActionHandler: typeof import("./queue/route").POST;
  let teamHandler: typeof import("./team/route").GET;
  let calendarHandler: typeof import("./calendar/route").GET;
  let taskReferencesHandler: typeof import("../tasks/references/route").GET;
  let taskCreateHandler: typeof import("../tasks/route").POST;
  let taskListHandler: typeof import("../tasks/route").GET;
  let taskActionHandler: typeof import("../tasks/[id]/route").PATCH;
  let taskReadHandler: typeof import("../tasks/[id]/route").GET;
  let escalationCreateHandler: typeof import("../escalations/route").POST;
  let escalationListHandler: typeof import("../escalations/route").GET;
  let escalationReadHandler: typeof import("../escalations/[id]/route").GET;
  let escalationActionHandler: typeof import("../escalations/[id]/route").PATCH;
  let collectionListHandler: typeof import("../collections/route").GET;
  let specimenListHandler: typeof import("../samples/route").GET;
  let specimenActionHandler: typeof import("../samples/route").POST;
  let dispatchListHandler: typeof import("../samples/dispatch/route").GET;
  let collectionActionHandler: typeof import("../collections/[id]/route").PATCH;
  let workloadHandler: typeof import("../roster/workload/route").GET;
  let rosterListHandler: typeof import("../roster/route").GET;
  let rosterDetailHandler: typeof import("../roster/[id]/route").GET;
  let rosterCreateHandler: typeof import("../roster/route").POST;
  let rosterActionHandler: typeof import("../roster/[id]/route").PATCH;
  let rosterConflictsHandler: typeof import("../roster/conflicts/route").GET;
  let approvalPolicyHandler: typeof import("../tasks/policy/route").PUT;
  let approvalPolicyReadHandler: typeof import("../tasks/policy/route").GET;
  let taskApproverPickerHandler: typeof import("../tasks/approvers/route").GET;
  let operationsHandler: typeof import("../branch/operations/route").GET;
  let doctorDirectoryHandler: typeof import("../doctors/route").GET;
  let doctorCreateHandler: typeof import("../doctors/route").POST;
  let doctorReadHandler: typeof import("../doctors/[id]/route").GET;
  let doctorUpdateHandler: typeof import("../doctors/[id]/route").PATCH;
  let doctorReferralHandler: typeof import("../doctors/[id]/referrals/route").POST;
  let doctorVisitHandler: typeof import("../doctors/[id]/visits/route").POST;
  let doctorVisitListHandler: typeof import("../doctors/[id]/visits/route").GET;
  let doctorLeadsHandler: typeof import("../doctors/[id]/leads/route").GET;
  let businessRelationshipListHandler: typeof import("../business-relationships/route").GET;
  let businessRelationshipCreateHandler: typeof import("../business-relationships/route").POST;
  let businessRelationshipReadHandler: typeof import("../business-relationships/[id]/route").GET;
  let businessRelationshipUpdateHandler: typeof import("../business-relationships/[id]/route").PATCH;
  let businessRelationshipActivityHandler: typeof import("../business-relationships/[id]/activities/route").POST;
  let businessRelationshipCentresHandler: typeof import("../business-relationships/centres/route").GET;
  let businessRelationshipLeadsHandler: typeof import("../business-relationships/[id]/leads/route").GET;
  let leadCreateHandler: typeof import("../leads/route").POST;
  let leadReadHandler: typeof import("../leads/[id]/route").GET;
  let leadUpdateHandler: typeof import("../leads/[id]/route").PATCH;
  let leadFollowupsHandler: typeof import("../followups/route").GET;
  let reportFollowupsHandler: typeof import("../report-followups/route").GET;
  let organizationId: string;
  let centreId: string;
  let staffUserId: string;
  let patientId: string;
  let failureFunction: string;
  let failureTrigger: string;

  beforeAll(async () => {
    loadProjectEnvironment();
    testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) throw new Error("A dedicated test database is required.");
    const schemaAdmin = new Pool({ connectionString: testUrl, max: 1 });
    await schemaAdmin.query(`CREATE SCHEMA "${schema}"`);
    await schemaAdmin.end();
    await runMigrations(testUrl, null, schema);
    const scopedUrl = new URL(testUrl);
    scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
    process.env.DATABASE_URL = scopedUrl.toString();
    pool = new Pool({ connectionString: scopedUrl.toString(), max: 1 });
    failureFunction = `fail_appt_service_${schema.slice(-12)}`;
    failureTrigger = `fail_appt_ins_${schema.slice(-12)}`;
    organizationId = randomUUID(); centreId = randomUUID(); staffUserId = randomUUID(); patientId = randomUUID();
    const authUserId = randomUUID();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `API-${organizationId.slice(0, 8)}`, "Synthetic appointment API test"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [centreId, organizationId, `C-${centreId.slice(0, 8)}`, "Synthetic Main Centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authUserId, "Synthetic API Staff", `${authUserId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',true)", [staffUserId, authUserId, organizationId, `ST-${staffUserId.slice(0, 8)}`, "Synthetic Owner"]);
    const workloadRoleId = randomUUID();
    await pool.query("INSERT INTO roles(id,organization_id,key,name,scope) VALUES($1,$2,'synthetic_workload','Synthetic workload role','CENTRE')", [workloadRoleId, organizationId]);
    await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, staffUserId, workloadRoleId, centreId]);
    await pool.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,consent_recorded_at,consent_method,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',NULL,NULL,$5)", [patientId, organizationId, centreId, `P-${patientId.slice(0, 8)}`, staffUserId]);
    const { encryptPatientContacts, encryptPatientIdentity } = await import("@/server/patient-contact-crypto");
    const context = { organizationId, centreId, patientId };
    const identity = encryptPatientIdentity({ firstName: "Synthetic", lastName: "Booking Patient" }, context);
    const contact = encryptPatientContacts({ phone: "+910000000001", email: null, profile: { dateOfBirth: "1990-01-01", sexAtRegistration: null, address: null, preferredName: null } }, context);
    await pool.query("INSERT INTO patient_contact_secrets(patient_id,organization_id,centre_id,encryption_key_id,phone_ciphertext,email_ciphertext,profile_ciphertext,name_ciphertext,phone_blind_index,email_blind_index,first_name_blind_index,last_name_blind_index,full_name_blind_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [patientId, organizationId, centreId, contact.encryptionKeyId, contact.phoneCiphertext, contact.emailCiphertext, contact.profileCiphertext, identity.nameCiphertext, contact.phoneBlindIndex, contact.emailBlindIndex, identity.firstNameBlindIndex, identity.lastNameBlindIndex, identity.fullNameBlindIndex]);
    const staff = { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }, { key: "appointments.update", centreId }, { key: "appointments.assign", centreId }, { key: "roster.read", centreId }, { key: "finance.read", centreId }] };
    mocks.getApiAccess.mockResolvedValue({ staff, response: null });
    mocks.getAppointmentReadAccess.mockResolvedValue({ staff, assignedOnly: false, response: null });
    mocks.listAssignableAppointmentStaff.mockResolvedValue([]);
    ({ POST: handler } = await import("./route"));
    ({ POST: patientCreateHandler } = await import("../patients/route"));
    ({ GET: readHandler } = await import("./[id]/route"));
    ({ PATCH: updateHandler } = await import("./[id]/route"));
    ({ POST: searchHandler } = await import("./search/route"));
    ({ POST: checkInHandler } = await import("./[id]/check-in/route"));
    ({ GET: queueHandler, POST: queueActionHandler } = await import("./queue/route"));
    ({ GET: teamHandler } = await import("./team/route"));
    ({ GET: calendarHandler } = await import("./calendar/route"));
    ({ GET: taskReferencesHandler } = await import("../tasks/references/route"));
    ({ GET: taskListHandler, POST: taskCreateHandler } = await import("../tasks/route"));
    ({ GET: taskReadHandler, PATCH: taskActionHandler } = await import("../tasks/[id]/route"));
    ({ POST: escalationCreateHandler } = await import("../escalations/route"));
    ({ GET: escalationListHandler } = await import("../escalations/route"));
    ({ GET: escalationReadHandler, PATCH: escalationActionHandler } = await import("../escalations/[id]/route"));
    ({ GET: collectionListHandler } = await import("../collections/route"));
    ({ GET: specimenListHandler, POST: specimenActionHandler } = await import("../samples/route"));
    ({ GET: dispatchListHandler } = await import("../samples/dispatch/route"));
    ({ PATCH: collectionActionHandler } = await import("../collections/[id]/route"));
    ({ GET: workloadHandler } = await import("../roster/workload/route"));
    ({ GET: rosterListHandler } = await import("../roster/route"));
    ({ GET: rosterDetailHandler } = await import("../roster/[id]/route"));
    ({ POST: rosterCreateHandler } = await import("../roster/route"));
    ({ PATCH: rosterActionHandler } = await import("../roster/[id]/route"));
    ({ GET: rosterConflictsHandler } = await import("../roster/conflicts/route"));
    ({ PUT: approvalPolicyHandler, GET: approvalPolicyReadHandler } = await import("../tasks/policy/route"));
    ({ GET: taskApproverPickerHandler } = await import("../tasks/approvers/route"));
    ({ GET: operationsHandler } = await import("../branch/operations/route"));
    ({ GET: doctorDirectoryHandler, POST: doctorCreateHandler } = await import("../doctors/route"));
    ({ GET: doctorReadHandler, PATCH: doctorUpdateHandler } = await import("../doctors/[id]/route"));
    ({ POST: doctorReferralHandler } = await import("../doctors/[id]/referrals/route"));
    ({ GET: doctorVisitListHandler, POST: doctorVisitHandler } = await import("../doctors/[id]/visits/route"));
    ({ GET: doctorLeadsHandler } = await import("../doctors/[id]/leads/route"));
    ({ GET: businessRelationshipListHandler, POST: businessRelationshipCreateHandler } = await import("../business-relationships/route"));
    ({ GET: businessRelationshipReadHandler, PATCH: businessRelationshipUpdateHandler } = await import("../business-relationships/[id]/route"));
    ({ POST: businessRelationshipActivityHandler } = await import("../business-relationships/[id]/activities/route"));
    ({ GET: businessRelationshipCentresHandler } = await import("../business-relationships/centres/route"));
    ({ GET: businessRelationshipLeadsHandler } = await import("../business-relationships/[id]/leads/route"));
    ({ POST: leadCreateHandler } = await import("../leads/route"));
    ({ GET: leadReadHandler } = await import("../leads/[id]/route"));
    ({ PATCH: leadUpdateHandler } = await import("../leads/[id]/route"));
    ({ GET: leadFollowupsHandler } = await import("../followups/route"));
    ({ GET: reportFollowupsHandler } = await import("../report-followups/route"));
  }, 120_000);

  beforeEach(() => {
    const staff = { organizationId, staffUserId, grants: [
      { key: "appointments.read", centreId }, { key: "appointments.create", centreId },
      { key: "appointments.update", centreId }, { key: "appointments.assign", centreId },
      { key: "roster.read", centreId }, { key: "roster.manage", centreId },
      { key: "finance.read", centreId }, { key: "workspace.read", centreId },
    ] };
    mocks.getApiAccess.mockReset();
    mocks.getApiAccess.mockResolvedValue({ staff, response: null });
    mocks.getAppointmentReadAccess.mockReset();
    mocks.getAppointmentReadAccess.mockResolvedValue({ staff, assignedOnly: false, response: null });
    mocks.listAssignableAppointmentStaff.mockReset();
    mocks.listAssignableAppointmentStaff.mockResolvedValue([]);
  });

  afterAll(async () => {
    const { closeDatabasePool } = await import("@/db/client");
    try { await closeDatabasePool(); } catch { /* already closed */ }
    await pool?.end();
    dropPool = new Pool({ connectionString: testUrl, max: 1 });
    await dropPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await dropPool.end();
    process.env.DATABASE_URL = testUrl;
  });

  function request(key: string, scheduledLocal = "2099-01-05T09:30") {
    return new Request("http://localhost/api/appointments", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key },
      body: JSON.stringify({ centreId, patientId, source: "WALK_IN", visitType: "CENTRE", scheduledLocal, durationMinutes: 30, services: [{ type: "OTHER", name: "DEMO-TEST-SERVICE" }] }),
    });
  }

  it("registers a walk-in patient and links the same record to a requested appointment", async () => {
    const walkInCentreId = randomUUID();
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [walkInCentreId, organizationId, `W-${walkInCentreId.slice(0, 8)}`, "Synthetic Walk-in Test Centre"]);
    const grants = [
      { key: "patients.create", centreId: walkInCentreId }, { key: "patients.read", centreId: walkInCentreId },
      { key: "appointments.create", centreId: walkInCentreId },
    ];
    const reception = { organizationId, staffUserId, grants };
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => grants.some((grant) => grant.key === permission && (!requestedCentre || grant.centreId === requestedCentre))
      ? { staff: reception, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });

    const patientResponse = await patientCreateHandler(new Request("http://localhost/api/patients", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ centreId: walkInCentreId, firstName: "Synthetic Walk-in", lastName: "Visitor", dateOfBirth: "1990-01-01", sexAtRegistration: "UNSPECIFIED", phone: `+9100${Date.now().toString().slice(-8)}`, consentStatus: "NOT_RECORDED", consentMethod: null }),
    }));
    expect(patientResponse.status).toBe(201);
    const createdPatient = await patientResponse.json() as { patient: { id: string; patientNumber: string } };

    const bookingResponse = await handler(new Request("http://localhost/api/appointments", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ centreId: walkInCentreId, patientId: createdPatient.patient.id, source: "WALK_IN", visitType: "CENTRE", scheduledLocal: "2099-08-20T16:00", durationMinutes: 30, services: [{ type: "OTHER", name: "SYNTHETIC-WALK-IN-SERVICE" }] }),
    }));
    expect(bookingResponse.status).toBe(201);
    const booking = await bookingResponse.json() as { appointment: { id: string; status: string } };
    expect(booking.appointment.status).toBe("REQUESTED");
    const persisted = await pool.query("SELECT patient_id,booking_source,status FROM appointments WHERE id=$1 AND organization_id=$2 AND centre_id=$3", [booking.appointment.id, organizationId, walkInCentreId]);
    expect(persisted.rows).toEqual([{ patient_id: createdPatient.patient.id, booking_source: "WALK_IN", status: "REQUESTED" }]);
    const encrypted = await pool.query("SELECT name_ciphertext,phone_ciphertext FROM patient_contact_secrets WHERE patient_id=$1", [createdPatient.patient.id]);
    expect(encrypted.rowCount).toBe(1);
    expect(encrypted.rows[0].name_ciphertext).not.toContain("Synthetic Walk-in");
  });

  it("commits a centre visit, replays idempotently, and reads encrypted service/history data", async () => {
    const key = randomUUID();
    const createdResponse = await handler(request(key));
    const createdBody = await createdResponse.json() as { appointment?: { id: string; appointmentNumber: string; status: string } };
    expect(createdResponse.status).toBe(201);
    expect(createdBody.appointment?.status).toBe("REQUESTED");
    const replayResponse = await handler(request(key));
    const replayBody = await replayResponse.json() as { appointment?: { id: string } };
    expect(replayResponse.status).toBe(200);
    expect(replayBody.appointment?.id).toBe(createdBody.appointment?.id);
    const { getDb } = await import("@/db/client");
    const persisted = await getDb().execute(sql`SELECT (SELECT count(*)::int FROM appointments WHERE id=${createdBody.appointment!.id}) AS appointment_count, (SELECT booking_source FROM appointments WHERE id=${createdBody.appointment!.id}) AS booking_source, (SELECT count(*)::int FROM appointment_services WHERE appointment_id=${createdBody.appointment!.id}) AS service_count, (SELECT count(*)::int FROM appointment_status_history WHERE appointment_id=${createdBody.appointment!.id}) AS history_count`);
    expect(persisted.rows[0]).toMatchObject({ appointment_count: 1, booking_source: "WALK_IN", service_count: 1, history_count: 1 });
    const secondRequest = new Request("http://localhost/api/appointments", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ centreId, patientId, source: "STAFF", visitType: "CENTRE", scheduledLocal: "2099-01-05T10:30", durationMinutes: 30, services: [{ type: "OTHER", name: "DEMO-TEST-SERVICE-2" }] }) });
    const secondCreatedResponse = await handler(secondRequest);
    expect(secondCreatedResponse.status).toBe(201);
    const teamPage = async (page: number) => teamHandler(new Request(`http://localhost/api/appointments/team?centreId=${centreId}&date=2099-01-05&page=${page}&pageSize=1`));
    const teamFirst = await (await teamPage(1)).json() as { appointments: Array<{ id: string }>; hasMore: boolean; page: number };
    const teamSecond = await (await teamPage(2)).json() as typeof teamFirst;
    expect(teamFirst).toMatchObject({ page: 1, hasMore: true });
    expect(teamSecond).toMatchObject({ page: 2, hasMore: false });
    expect(teamFirst.appointments[0]?.id).not.toBe(teamSecond.appointments[0]?.id);
    const calendarPage = async (page: number) => calendarHandler(new Request(`http://localhost/api/appointments/calendar?centreId=${centreId}&date=2099-01-05&view=day&page=${page}&pageSize=1`));
    const calendarFirst = await (await calendarPage(1)).json() as { appointments: Array<{ id: string }>; hasMore: boolean; page: number };
    const calendarSecond = await (await calendarPage(2)).json() as typeof calendarFirst;
    expect(calendarFirst).toMatchObject({ page: 1, hasMore: true });
    expect(calendarSecond).toMatchObject({ page: 2, hasMore: false });
    expect(calendarFirst.appointments[0]?.id).not.toBe(calendarSecond.appointments[0]?.id);
    const referencesPage = async (page: number) => taskReferencesHandler(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=APPOINTMENT&page=${page}&pageSize=1`));
    const referencesFirst = await (await referencesPage(1)).json() as { references: Array<{ id: string }>; hasMore: boolean; page: number };
    const referencesSecond = await (await referencesPage(2)).json() as typeof referencesFirst;
    expect(referencesFirst).toMatchObject({ page: 1, hasMore: true });
    expect(referencesSecond).toMatchObject({ page: 2, hasMore: false });
    expect(referencesFirst.references[0]?.id).not.toBe(referencesSecond.references[0]?.id);
    const otherStaffId = randomUUID();
    const otherAuthUserId = randomUUID();
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [otherAuthUserId, "Synthetic Other Staff", `${otherAuthUserId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status) VALUES($1,$2,$3,$4,$5,'ACTIVE')", [otherStaffId, otherAuthUserId, organizationId, `ST-${otherStaffId.slice(0, 8)}`, "Synthetic Other Staff"]);
    const assignedTaskId = randomUUID();
    const supportTaskId = randomUUID();
    const unrelatedTaskId = randomUUID();
    const unrelatedQueueTasks = Array.from({ length: 101 }, () => randomUUID());
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    for (const task of [
      { id: assignedTaskId, number: `T-${assignedTaskId.slice(0, 8)}`, type: "GENERAL", assigned: staffUserId, dueAt: null as Date | null },
      { id: supportTaskId, number: `T-${supportTaskId.slice(0, 8)}`, type: "SUPPORT_REQUEST", assigned: otherStaffId, dueAt: null as Date | null },
      { id: unrelatedTaskId, number: `T-${unrelatedTaskId.slice(0, 8)}`, type: "GENERAL", assigned: otherStaffId, dueAt: null as Date | null },
      ...unrelatedQueueTasks.map((id, index) => ({ id, number: `T-${id.slice(0, 8)}`, type: "GENERAL", assigned: otherStaffId, dueAt: new Date(Date.UTC(2000, 0, 1) + index * 1000) })),
    ]) {
      const unauthorizedTask = task.type === "GENERAL" && task.assigned !== staffUserId;
      const privateData = encryptOperationalData({ title: `Synthetic task ${task.id}`, description: unauthorizedTask ? "UNAUTHORIZED SYNTHETIC PRIVATE SENTINEL" : "Authorized synthetic task details" }, operationalContext({ organizationId, centreId, recordId: task.id }, "staff-task"));
      await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,approval_status,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash,due_at) VALUES($1,$2,$3,$4,$5,$6,'NORMAL','OPEN','NOT_REQUIRED',$7,$8,$9,$10,$11)", [task.id, organizationId, centreId, task.number, privateData, task.type, task.assigned, staffUserId, randomUUID(), "c".repeat(64), task.dueAt ?? null]);
    }
    const taskReadStaff = { organizationId, staffUserId, grants: [{ key: "tasks.assigned.read", centreId }, { key: "tasks.support.read", centreId }] };
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => {
      const allowed = taskReadStaff.grants.some((grant) => grant.key === permission && (grant.centreId === null || grant.centreId === requestedCentre));
      return allowed ? { staff: taskReadStaff, response: null } : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) };
    });
    const taskReferencesResponse = await taskReferencesHandler(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=STAFF_TASK`));
    expect(taskReferencesResponse.status).toBe(200);
    const taskReferences = await taskReferencesResponse.json() as { references: Array<{ id: string; label: string }> };
    expect(taskReferences.references.map((item) => item.id)).toEqual(expect.arrayContaining([assignedTaskId, supportTaskId]));
    expect(taskReferences.references.map((item) => item.id)).not.toContain(unrelatedTaskId);
    expect(JSON.stringify(taskReferences)).not.toContain("synthetic-private-title");
    const taskQueueResponse = await taskListHandler(new Request(`http://localhost/api/tasks?centreId=${centreId}`));
    expect(taskQueueResponse.status).toBe(200);
    const taskQueue = await taskQueueResponse.json() as { tasks: Array<{ id: string; title: string }>; hasMore: boolean };
    expect(taskQueue.tasks.map((task) => task.id)).toEqual(expect.arrayContaining([assignedTaskId, supportTaskId]));
    expect(taskQueue.tasks.map((task) => task.id)).not.toContain(unrelatedTaskId);
    expect(taskQueue.tasks).toHaveLength(2);
    expect(taskQueue.hasMore).toBe(false);
    expect(JSON.stringify(taskQueue)).not.toContain("UNAUTHORIZED SYNTHETIC PRIVATE SENTINEL");
    taskReadStaff.grants = [{ key: "tasks.assigned.read", centreId }];
    const assignedOnlyResponse = await taskReferencesHandler(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=STAFF_TASK`));
    const assignedOnly = await assignedOnlyResponse.json() as { references: Array<{ id: string }> };
    expect(assignedOnly.references.map((item) => item.id)).toContain(assignedTaskId);
    expect(assignedOnly.references.map((item) => item.id)).not.toContain(supportTaskId);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }, { key: "appointments.update", centreId }, { key: "appointments.assign", centreId }, { key: "roster.read", centreId }, { key: "finance.read", centreId }] }, response: null });
    const detailResponse = await readHandler(new Request(`http://localhost/api/appointments/${createdBody.appointment!.id}`), { params: Promise.resolve({ id: createdBody.appointment!.id }) });
    expect(detailResponse.status).toBe(200);
    let detail = await detailResponse.json() as { appointment: { status: string; updatedAt: string; assignedStaffId: string | null; assignedStaffName: string | null; patient: { firstName: string; lastName: string } }; services: Array<{ serviceName: string }>; history: Array<{ toStatus: string; reason: string }>; arrival: { arrivedAt: string; actorName: string } | null };
    expect(detail.appointment.assignedStaffId).toBeNull();
    expect(detail.appointment.assignedStaffName).toBeNull();
    expect(detail.appointment.patient).toMatchObject({ firstName: "Synthetic", lastName: "Booking Patient" });
    expect(detail.services[0]?.serviceName).toBe("DEMO-TEST-SERVICE");
    expect(detail.history[0]).toMatchObject({ toStatus: "REQUESTED", reason: "Booking request recorded; confirmation pending staff review" });
    const searchRequest = (body: unknown) => new Request("http://localhost/api/appointments/search", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(body) });
    let searchResponse = await searchHandler(searchRequest({ q: "", centreId, status: null, visitType: null, page: 1, pageSize: 25 }));
    let listed = await searchResponse.json() as { appointments: Array<{ id: string; canCheckIn: boolean; arrivalAt: string | null }> };
    expect(listed.appointments.find((row) => row.id === createdBody.appointment!.id)).toMatchObject({ canCheckIn: false, arrivalAt: null });
    const walkIns = await (await searchHandler(searchRequest({ q: "", centreId, status: "REQUESTED", source: "WALK_IN", visitType: null, page: 1, pageSize: 25 }))).json() as { appointments: Array<{ id: string }> };
    const staffBookings = await (await searchHandler(searchRequest({ q: "", centreId, status: "REQUESTED", source: "STAFF", visitType: null, page: 1, pageSize: 25 }))).json() as { appointments: Array<{ id: string }> };
    expect(walkIns.appointments.map((row) => row.id)).toContain(createdBody.appointment!.id);
    expect(walkIns.appointments.map((row) => row.id)).not.toContain((await secondCreatedResponse.json() as { appointment: { id: string } }).appointment.id);
    expect(staffBookings.appointments).toHaveLength(1);
    const patchRequest = (body: unknown) => new Request(`http://localhost/api/appointments/${createdBody.appointment!.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(body) });
    const confirmResponse = await updateHandler(patchRequest({ status: "CONFIRMED", reason: "Synthetic reception confirmation", expectedUpdatedAt: detail.appointment.updatedAt }), { params: Promise.resolve({ id: createdBody.appointment!.id }) });
    expect(confirmResponse.status).toBe(200);
    detail = await (await readHandler(new Request(`http://localhost/api/appointments/${createdBody.appointment!.id}`), { params: Promise.resolve({ id: createdBody.appointment!.id }) })).json() as typeof detail;
    const assignmentResponse = await updateHandler(patchRequest({ assignedStaffId: staffUserId, reason: "Synthetic authorized appointment assignment", expectedUpdatedAt: detail.appointment.updatedAt }), { params: Promise.resolve({ id: createdBody.appointment!.id }) });
    expect(assignmentResponse.status).toBe(200);
    detail = await (await readHandler(new Request(`http://localhost/api/appointments/${createdBody.appointment!.id}`), { params: Promise.resolve({ id: createdBody.appointment!.id }) })).json() as typeof detail;
    expect(detail.appointment.assignedStaffName).toBe("Synthetic Owner");
    await pool.query("UPDATE appointments a SET scheduled_at=((date_trunc('day', now() AT TIME ZONE c.time_zone) + interval '1 hour') AT TIME ZONE c.time_zone) FROM centres c WHERE a.id=$1 AND c.id=a.centre_id", [createdBody.appointment!.id]);
    detail = await (await readHandler(new Request(`http://localhost/api/appointments/${createdBody.appointment!.id}`), { params: Promise.resolve({ id: createdBody.appointment!.id }) })).json() as typeof detail;
    searchResponse = await searchHandler(searchRequest({ q: "", centreId, status: null, visitType: null, page: 1, pageSize: 25 }));
    listed = await searchResponse.json() as typeof listed;
    expect(listed.appointments.find((row) => row.id === createdBody.appointment!.id)?.canCheckIn).toBe(true);
    const arrivalsResponse = await searchHandler(searchRequest({ q: "", centreId, status: null, visitType: "CENTRE", awaitingArrival: true, page: 1, pageSize: 25 }));
    const arrivals = await arrivalsResponse.json() as { appointments: Array<{ id: string; arrivalAt: string | null }> };
    const arrivalPreflight = await pool.query("SELECT a.status, a.visit_type, a.scheduled_at >= date_trunc('day', now() AT TIME ZONE c.time_zone) AT TIME ZONE c.time_zone AS starts_today, a.scheduled_at < (date_trunc('day', now() AT TIME ZONE c.time_zone) + interval '1 day') AT TIME ZONE c.time_zone AS ends_today FROM appointments a JOIN centres c ON c.id=a.centre_id WHERE a.id=$1", [createdBody.appointment!.id]);
    expect(arrivalPreflight.rows[0]).toMatchObject({ status: "ASSIGNED", visit_type: "CENTRE", starts_today: true, ends_today: true });
    expect(arrivals.appointments.find((row) => row.id === createdBody.appointment!.id)).toMatchObject({ arrivalAt: null });
    const arrivalKey = randomUUID();
    const arrivalRequest = () => new Request(`http://localhost/api/appointments/${createdBody.appointment!.id}/check-in`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": arrivalKey }, body: JSON.stringify({ arrivalConfirmed: true }) });
    const arrivalParams = { params: Promise.resolve({ id: createdBody.appointment!.id }) };
    expect((await checkInHandler(arrivalRequest(), arrivalParams)).status).toBe(201);
    expect((await checkInHandler(arrivalRequest(), arrivalParams)).status).toBe(200);
    detail = await (await readHandler(new Request(`http://localhost/api/appointments/${createdBody.appointment!.id}`), { params: Promise.resolve({ id: createdBody.appointment!.id }) })).json() as typeof detail;
    expect(detail.arrival?.actorName).toBe("Synthetic Owner");
    const afterArrivalSearch = await searchHandler(searchRequest({ q: "", centreId, status: null, visitType: null, page: 1, pageSize: 25 }));
    listed = await afterArrivalSearch.json() as typeof listed;
    expect(listed.appointments.find((row) => row.id === createdBody.appointment!.id)).toMatchObject({ canCheckIn: false });
    const afterCheckInArrivalQueue = await searchHandler(searchRequest({ q: "", centreId, status: null, visitType: "CENTRE", awaitingArrival: true, page: 1, pageSize: 25 }));
    const arrivalsAfterCheckIn = await afterCheckInArrivalQueue.json() as { appointments: Array<{ id: string }> };
    expect(arrivalsAfterCheckIn.appointments.some((row) => row.id === createdBody.appointment!.id)).toBe(false);
    const issueKey = randomUUID();
    const issueRequest = () => new Request("http://localhost/api/appointments/queue", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": issueKey }, body: JSON.stringify({ action: "ISSUE", centreId, appointmentId: createdBody.appointment!.id }) });
    const issueResponse = await queueActionHandler(issueRequest());
    const issued = await issueResponse.json() as { token: { id: string; tokenNumber: number; status: string; replayed: boolean } };
    expect(issueResponse.status).toBe(201);
    expect(issued.token).toMatchObject({ tokenNumber: 1, status: "WAITING", replayed: false });
    const issueReplay = await queueActionHandler(issueRequest());
    expect(issueReplay.status).toBe(200);
    expect((await issueReplay.json() as typeof issued).token).toMatchObject({ id: issued.token.id, replayed: true });
    const duplicateIssue = await queueActionHandler(new Request("http://localhost/api/appointments/queue", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "ISSUE", centreId, appointmentId: createdBody.appointment!.id }) }));
    expect(duplicateIssue.status).toBe(409);
    const callKey = randomUUID();
    const callRequest = () => new Request("http://localhost/api/appointments/queue", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": callKey }, body: JSON.stringify({ action: "CALL_NEXT", centreId }) });
    const callResponse = await queueActionHandler(callRequest());
    expect(callResponse.status).toBe(201);
    expect((await callResponse.json() as typeof issued).token).toMatchObject({ id: issued.token.id, status: "CALLED", replayed: false });
    const callReplay = await queueActionHandler(callRequest());
    expect(callReplay.status).toBe(200);
    expect((await callReplay.json() as typeof issued).token).toMatchObject({ id: issued.token.id, status: "CALLED", replayed: true });
    const queuePage = await queueHandler(new Request(`http://localhost/api/appointments/queue?centreId=${centreId}&page=1&pageSize=1`));
    expect(queuePage.status).toBe(200);
    expect(await queuePage.json()).toMatchObject({ page: 1, pageSize: 1, hasMore: false, pendingTokens: 0, walkIns: [expect.objectContaining({ id: createdBody.appointment!.id, tokenNumber: 1, queueStatus: "CALLED", patientName: "Synthetic Booking Patient" })] });
    const queueEvents = await pool.query("SELECT event_type FROM appointment_queue_events WHERE queue_token_id=$1 ORDER BY recorded_at", [issued.token.id]);
    expect(queueEvents.rows.map((row: { event_type: string }) => row.event_type)).toEqual(["ISSUED", "CALLED"]);
    await expect(pool.query("UPDATE appointment_queue_events SET request_hash=$2 WHERE queue_token_id=$1", [issued.token.id, "f".repeat(64)])).rejects.toThrow();
    await expect(pool.query("DELETE FROM appointment_queue_events WHERE queue_token_id=$1", [issued.token.id])).rejects.toThrow();
    await expect(queueActionHandler(new Request("http://localhost/api/appointments/queue", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": issueKey }, body: JSON.stringify({ action: "CALL_NEXT", centreId }) }))).resolves.toMatchObject({ status: 409 });
    const cancelAfterArrival = await updateHandler(patchRequest({ status: "CANCELLED", reason: "Synthetic cancellation attempt", expectedUpdatedAt: detail.appointment.updatedAt }), { params: Promise.resolve({ id: createdBody.appointment!.id }) });
    expect(cancelAfterArrival.status).toBe(409);
    expect(await cancelAfterArrival.json()).toMatchObject({ error: "appointment_already_checked_in" });
  });

  it("keeps private booking values out of request hashes and checks encrypted values on replay", async () => {
    const key = randomUUID();
    const payload = {
      centreId, patientId, source: "STAFF", visitType: "HOME_COLLECTION", scheduledLocal: "2099-01-05T08:00",
      durationMinutes: 30, services: [{ type: "TEST", name: "SYNTHETIC PRIVATE TEST LABEL", reference: "SYNTHETIC-PRIVATE-REF" }],
      homeCollection: {
        address: { line1: "123 Synthetic Lane", city: "Example City", state: "Example State", postalCode: "000001" },
        preferredWindow: "08:00-09:00", instructions: "SYNTHETIC PRIVATE ACCESS NOTE", chargeChoice: "99",
      },
    };
    const send = (body: typeof payload) => handler(new Request("http://localhost/api/appointments", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body),
    }));
    const response = await send(payload);
    expect(response.status).toBe(201);
    const created = await response.json() as { appointment: { id: string } };
    expect((await send(payload)).status).toBe(200);
    const changed = structuredClone(payload);
    changed.homeCollection.address.line1 = "456 Different Synthetic Lane";
    expect((await send(changed)).status).toBe(409);
    const stored = await pool.query("SELECT request_hash,private_data_ciphertext FROM appointments WHERE id=$1", [created.appointment.id]);
    expect(stored.rowCount).toBe(1);
    expect(stored.rows[0].request_hash).not.toBe(createHash("sha256").update(JSON.stringify(payload)).digest("hex"));
    expect(stored.rows[0].private_data_ciphertext).not.toContain("Synthetic Lane");
    expect(stored.rows[0].private_data_ciphertext).not.toContain("SYNTHETIC PRIVATE ACCESS NOTE");
    const replay = await (await send(payload)).json() as { appointment: Record<string, unknown> };
    expect(replay.appointment).not.toHaveProperty("privateDataCiphertext");
    expect(replay.appointment).not.toHaveProperty("requestHash");
  });

  it("creates one staff task on a lost-response retry and rejects a changed request using the same key", async () => {
    const idempotencyKey = randomUUID();
    // Keep this API regression's persisted task outside the appointment/operations
    // fixtures so it cannot change their queue counts or pagination assertions.
    const taskCentreId = randomUUID();
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [taskCentreId, organizationId, `T-${taskCentreId.slice(0, 8)}`, "Synthetic Task Test Centre"]);
    const taskRoleId = randomUUID();
    await pool.query("INSERT INTO roles(id,organization_id,key,name,scope) VALUES($1,$2,$3,$4,'CENTRE')", [taskRoleId, organizationId, `synthetic_task_${taskRoleId.slice(0, 8)}`, "Synthetic task test role"]);
    await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, staffUserId, taskRoleId, taskCentreId]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "tasks.read", centreId: taskCentreId }, { key: "tasks.create", centreId: taskCentreId }, { key: "tasks.update", centreId: taskCentreId }] }, response: null });
    const taskRequest = (title: string) => new Request("http://localhost/api/tasks", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ centreId: taskCentreId, assignedStaffId: staffUserId, title, description: "Synthetic idempotency regression", priority: "NORMAL", taskType: "GENERAL", dueAt: null, requiresApproval: false, reference: null }) });
    const first = await taskCreateHandler(taskRequest("Synthetic idempotent task"));
    expect(first.status, JSON.stringify(await first.clone().json())).toBe(201);
    const created = await first.json() as { task: { id: string; taskNumber: string } };
    const replay = await taskCreateHandler(taskRequest("Synthetic idempotent task"));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ task: { id: created.task.id, taskNumber: created.task.taskNumber, replayed: true } });
    const conflict = await taskCreateHandler(taskRequest("Changed synthetic task"));
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toEqual({ error: "idempotency_conflict" });
    const persisted = await pool.query("SELECT count(*)::int AS count FROM staff_tasks WHERE idempotency_key=$1 AND organization_id=$2 AND centre_id=$3", [idempotencyKey, organizationId, taskCentreId]);
    expect(persisted.rows[0]?.count).toBe(1);
    const act = (payload: Record<string, unknown>, key = randomUUID()) => new Request(`http://localhost/api/tasks/${created.task.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(payload) });
    const startKey = randomUUID();
    const started = await taskActionHandler(act({ action: "START", expectedVersion: 1 }, startKey), { params: Promise.resolve({ id: created.task.id }) });
    expect(started.status, JSON.stringify(await started.clone().json())).toBe(200);
    expect(await started.json()).toMatchObject({ task: { id: created.task.id, versionNumber: 2, status: "IN_PROGRESS" }, replayed: false });
    const startedReplay = await taskActionHandler(act({ action: "START", expectedVersion: 1 }, startKey), { params: Promise.resolve({ id: created.task.id }) });
    expect(startedReplay.status).toBe(200);
    expect(await startedReplay.json()).toMatchObject({ task: { versionNumber: 2, status: "IN_PROGRESS" }, replayed: true });
    const updated = await taskActionHandler(act({ action: "UPDATE", expectedVersion: 2, title: "Synthetic updated task", description: "Encrypted updated description" }), { params: Promise.resolve({ id: created.task.id }) });
    expect(updated.status).toBe(200);
    expect(await updated.json()).toMatchObject({ task: { versionNumber: 3, status: "IN_PROGRESS" } });
    const commented = await taskActionHandler(act({ action: "COMMENT", expectedVersion: 3, comment: "Synthetic progress note" }), { params: Promise.resolve({ id: created.task.id }) });
    expect(commented.status).toBe(200);
    expect(await commented.json()).toMatchObject({ task: { versionNumber: 4 } });
    const completed = await taskActionHandler(act({ action: "COMPLETE", expectedVersion: 4 }), { params: Promise.resolve({ id: created.task.id }) });
    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({ task: { versionNumber: 5, status: "COMPLETED" } });
    const reopenReason = "Synthetic review found one remaining task step";
    const reopened = await taskActionHandler(act({ action: "REOPEN", expectedVersion: 5, reason: reopenReason }), { params: Promise.resolve({ id: created.task.id }) });
    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toMatchObject({ task: { versionNumber: 6, status: "OPEN" } });
    const taskDetails = await taskReadHandler(new Request(`http://localhost/api/tasks/${created.task.id}`), { params: Promise.resolve({ id: created.task.id }) });
    expect(taskDetails.status).toBe(200);
    const details = await taskDetails.json() as { task: { title: string; description: string }; history: Array<{ eventType: string; comment?: string; reason?: string }> };
    expect(details.task).toMatchObject({ title: "Synthetic updated task", description: "Encrypted updated description" });
    expect(details.history.map((event) => event.eventType)).toEqual(["CREATED", "STARTED", "UPDATED", "COMMENTED", "COMPLETED", "REOPENED"]);
    expect(details.history.at(-1)?.reason).toBe(reopenReason);
    expect(details.history.find((event) => event.eventType === "COMMENTED")?.comment).toBe("Synthetic progress note");
    const privateRows = await pool.query("SELECT private_data_ciphertext FROM staff_task_events WHERE task_id=$1 ORDER BY recorded_at", [created.task.id]);
    expect(privateRows.rows).toHaveLength(6);
    expect(JSON.stringify(privateRows.rows)).not.toContain("Synthetic progress note");
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }, { key: "appointments.update", centreId }, { key: "appointments.assign", centreId }, { key: "roster.read", centreId }, { key: "finance.read", centreId }] }, response: null });
  });

  it("orders paginated approval-expiry work by its actual deadline, not the optional task due date", async () => {
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    const taskCentreId = randomUUID();
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [taskCentreId, organizationId, `X-${taskCentreId.slice(0, 8)}`, "Synthetic Approval Queue Centre"]);
    const taskRoleId = randomUUID();
    await pool.query("INSERT INTO roles(id,organization_id,key,name,scope) VALUES($1,$2,$3,$4,'CENTRE')", [taskRoleId, organizationId, `synthetic_expiry_${taskRoleId.slice(0, 8)}`, "Synthetic approval queue role"]);
    await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, staffUserId, taskRoleId, taskCentreId]);
    const rows: Array<{ id: string; title: string; expiresAt: Date; escalationAt: Date }> = [];
    for (let index = 0; index <= 100; index += 1) {
      const id = randomUUID();
      const title = `Synthetic approval expiry ${index}`;
      const expiresAt = new Date(Date.UTC(2020, 0, 1, 0, 0, 0) + (100 - index) * 60_000);
      const escalationAt = new Date(Date.UTC(2020, 0, 2, 0, 0, 0) + index * 60_000);
      const ciphertext = encryptOperationalData({ title, description: "Synthetic due approval" }, operationalContext({ organizationId, centreId: taskCentreId, recordId: id }, "staff-task"));
      await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,approval_expires_at,escalation_owner_staff_id,escalation_due_at,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash,due_at) VALUES($1,$2,$3,$4,$5,'GENERAL','NORMAL','AWAITING_APPROVAL',true,'PENDING',$6,$7,$8,$7,$7,$9,$10,NULL)", [id, organizationId, taskCentreId, `EX-${id.slice(0, 8)}`, ciphertext, expiresAt, staffUserId, escalationAt, randomUUID(), "d".repeat(64)]);
      rows.push({ id, title, expiresAt, escalationAt });
    }
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => permission === "tasks.read" && requestedCentre === taskCentreId
      ? { staff: { organizationId, staffUserId, grants: [{ key: "tasks.read", centreId: taskCentreId }] }, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await taskListHandler(new Request(`http://localhost/api/tasks?centreId=${taskCentreId}&status=APPROVAL_EXPIRY_DUE`));
    expect(response.status).toBe(200);
    const body = await response.json() as { tasks: Array<{ id: string; title: string; approvalExpiresAt: string }>; hasMore: boolean };
    expect(body.tasks).toHaveLength(100);
    expect(body.hasMore).toBe(true);
    const expected = [...rows].sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime()).slice(0, 100);
    expect(body.tasks.map((task) => task.id)).toEqual(expected.map((task) => task.id));
    expect(body.tasks[0]?.title).toBe("Synthetic approval expiry 100");
    const escalationResponse = await taskListHandler(new Request(`http://localhost/api/tasks?centreId=${taskCentreId}&status=APPROVAL_ESCALATION_DUE`));
    expect(escalationResponse.status).toBe(200);
    const escalationBody = await escalationResponse.json() as { tasks: Array<{ id: string }>; hasMore: boolean };
    expect(escalationBody.tasks).toHaveLength(100);
    expect(escalationBody.hasMore).toBe(true);
    const expectedEscalations = [...rows].sort((a, b) => a.escalationAt.getTime() - b.escalationAt.getTime()).slice(0, 100);
    expect(escalationBody.tasks.map((task) => task.id)).toEqual(expectedEscalations.map((task) => task.id));
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }, { key: "appointments.update", centreId }, { key: "appointments.assign", centreId }, { key: "roster.read", centreId }, { key: "finance.read", centreId }] }, response: null });
  });

  it("detects assignment overlaps across roster conflict pagination boundaries", async () => {
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    const testCentreId = randomUUID();
    const testPatientId = randomUUID();
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [testCentreId, organizationId, `R-${testCentreId.slice(0, 8)}`, "Synthetic Roster Conflict Centre"]);
    await pool.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,consent_recorded_at,consent_method,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',NULL,NULL,$5)", [testPatientId, organizationId, testCentreId, `P-${testPatientId.slice(0, 8)}`, staffUserId]);
    const roleId = randomUUID();
    await pool.query("INSERT INTO roles(id,organization_id,key,name,scope) VALUES($1,$2,$3,$4,'CENTRE')", [roleId, organizationId, `synthetic_roster_${roleId.slice(0, 8)}`, "Synthetic roster conflict role"]);
    await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, staffUserId, roleId, testCentreId]);
    const start = new Date("2099-01-01T00:00:00.000Z");
    const overlapIds: string[] = [];
    for (let index = 0; index <= 100; index += 1) {
      const id = randomUUID();
      const scheduledAt = new Date(start.getTime() + (index === 100 ? 99 * 60 + 15 : index * 60) * 60_000);
      if (index >= 99) overlapIds.push(id);
      const privateData = encryptOperationalData({ homeCollectionAddress: null, collectionInstructions: null, communicationEvidenceReference: null, homeChargeReason: null }, operationalContext({ organizationId, centreId: testCentreId, recordId: id }, "appointment"));
      await pool.query("INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,booking_source,visit_type,scheduled_at,duration_minutes,time_zone,status,assigned_staff_id,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'STAFF','CENTRE',$6,30,'Asia/Kolkata','CONFIRMED',$7,$8,$7,$9,$10)", [id, organizationId, testCentreId, `RO-${id.slice(0, 8)}`, testPatientId, scheduledAt, staffUserId, privateData, randomUUID(), "e".repeat(64)]);
    }
    const grants = [{ key: "roster.read", centreId: testCentreId }, { key: "appointments.read", centreId: testCentreId }];
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => grants.some((grant) => grant.key === permission && grant.centreId === requestedCentre)
      ? { staff: { organizationId, staffUserId, grants }, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const query = (page: number) => new Request(`http://localhost/api/roster/conflicts?centreId=${testCentreId}&from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent("2099-01-06T00:00:00.000Z")}&page=${page}`);
    const firstPage = await rosterConflictsHandler(query(1));
    expect(firstPage.status).toBe(200);
    const firstBody = await firstPage.json() as { conflicts: Array<{ id: string; advisoryFlags: string[] }>; hasMore: boolean };
    expect(firstBody.hasMore).toBe(true);
    expect(firstBody.conflicts.find((item) => item.id === overlapIds[0])?.advisoryFlags).toContain("OVERLAPPING_ASSIGNMENT");
    const secondPage = await rosterConflictsHandler(query(2));
    expect(secondPage.status).toBe(200);
    const secondBody = await secondPage.json() as { conflicts: Array<{ id: string; advisoryFlags: string[] }>; hasMore: boolean };
    expect(secondBody.hasMore).toBe(false);
    expect(secondBody.conflicts.find((item) => item.id === overlapIds[1])?.advisoryFlags).toContain("OVERLAPPING_ASSIGNMENT");

    const otherStaffId = randomUUID(); const otherAuthUserId = randomUUID(); const otherCentreId = randomUUID();
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [otherAuthUserId, "Synthetic other escalation owner", `${otherAuthUserId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [otherStaffId, otherAuthUserId, organizationId, `RO-${otherStaffId.slice(0, 8)}`, "Synthetic other escalation owner"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [otherCentreId, organizationId, `RX-${otherCentreId.slice(0, 8)}`, "Synthetic unrelated centre"]);
    const assignedEscalationId = randomUUID(); const otherOwnerEscalationId = randomUUID(); const otherCentreEscalationId = randomUUID();
    const insertEscalation = async (id: string, scopeCentreId: string, number: string, assignedOwnerId: string) => {
      const ciphertext = encryptOperationalData({ title: "Synthetic private roster escalation", description: "Synthetic confidential review details" }, operationalContext({ organizationId, centreId: scopeCentreId, recordId: id }, "staff-escalation"));
      await pool.query("INSERT INTO staff_escalations(id,organization_id,centre_id,escalation_number,source_type,source_id,private_data_ciphertext,severity,priority,status,assigned_owner_staff_id,created_by_staff_id,due_at,idempotency_key,request_hash,version_number) VALUES($1,$2,$3,$4,'APPOINTMENT',$5,$6,'MODERATE','NORMAL','OPEN',$7,$8,now()+interval '1 day',$9,$10,1)", [id, organizationId, scopeCentreId, number, overlapIds[0], ciphertext, assignedOwnerId, staffUserId, randomUUID(), "f".repeat(64)]);
    };
    await insertEscalation(assignedEscalationId, testCentreId, `RE-${assignedEscalationId.slice(0, 8)}`, staffUserId);
    await insertEscalation(otherOwnerEscalationId, testCentreId, `RE-${otherOwnerEscalationId.slice(0, 8)}`, otherStaffId);
    await insertEscalation(otherCentreEscalationId, otherCentreId, `RE-${otherCentreEscalationId.slice(0, 8)}`, staffUserId);
    let escalationGrants = [{ key: "roster.read", centreId: testCentreId }, { key: "appointments.read", centreId: testCentreId }, { key: "escalations.assigned.read", centreId: testCentreId }];
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => escalationGrants.some((grant) => grant.key === permission && grant.centreId === requestedCentre)
      ? { staff: { organizationId, staffUserId, grants: escalationGrants }, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const assignedOnlyResponse = await rosterConflictsHandler(query(1));
    expect(assignedOnlyResponse.status).toBe(200);
    const assignedOnlyBody = await assignedOnlyResponse.json() as { conflicts: Array<{ id: string; relatedEscalationId?: string }> };
    expect(assignedOnlyBody.conflicts.find((item) => item.id === overlapIds[0])?.relatedEscalationId).toBe(assignedEscalationId);
    expect(JSON.stringify(assignedOnlyBody)).not.toContain("Synthetic confidential");

    escalationGrants = [...escalationGrants, { key: "escalations.read", centreId: testCentreId }];
    const broadResponse = await rosterConflictsHandler(query(1));
    const broadBody = await broadResponse.json() as { conflicts: Array<{ id: string; relatedEscalationId?: string }> };
    expect([assignedEscalationId, otherOwnerEscalationId]).toContain(broadBody.conflicts.find((item) => item.id === overlapIds[0])?.relatedEscalationId);
    expect(broadBody.conflicts.some((item) => item.relatedEscalationId === otherCentreEscalationId)).toBe(false);

    escalationGrants = escalationGrants.filter((grant) => grant.key !== "escalations.read" && grant.key !== "escalations.assigned.read");
    const noEscalationReadResponse = await rosterConflictsHandler(query(1));
    const noEscalationReadBody = await noEscalationReadResponse.json() as { conflicts: Array<{ id: string; relatedEscalationId?: string }> };
    expect(noEscalationReadBody.conflicts.every((item) => item.relatedEscalationId === undefined)).toBe(true);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }, { key: "appointments.update", centreId }, { key: "appointments.assign", centreId }, { key: "roster.read", centreId }, { key: "finance.read", centreId }] }, response: null });
  });

  it("persists an escalation event, replays idempotently, and deduplicates an open source", async () => {
    const appointmentResponse = await handler(request(randomUUID()));
    expect(appointmentResponse.status).toBe(201);
    const appointment = await appointmentResponse.json() as { appointment: { id: string } };
    const workloadRole = await pool.query("SELECT id FROM roles WHERE organization_id=$1 AND key='synthetic_workload'", [organizationId]);
    const readPermissionId = randomUUID();
    await pool.query("INSERT INTO permissions(id,key,description,scope) VALUES($1,'escalations.read','Synthetic escalation read permission','CENTRE') ON CONFLICT(key) DO NOTHING", [readPermissionId]);
    const permission = await pool.query("SELECT id FROM permissions WHERE key='escalations.read'");
    await pool.query("INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [workloadRole.rows[0].id, permission.rows[0].id]);
    const grants = [
      { key: "workspace.read", centreId }, { key: "appointments.read", centreId },
      { key: "escalations.create", centreId }, { key: "escalations.read", centreId }, { key: "escalations.manage", centreId }, { key: "leads.read", centreId }, { key: "leads.followups.manage", centreId }, { key: "corporate.read", centreId }, { key: "doctors.read", centreId },
    ];
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants }, response: null });
    const key = randomUUID();
    const body = { centreId, source: { type: "APPOINTMENT", id: appointment.appointment.id }, title: "Synthetic booking blocker", description: "Synthetic escalation integration", severity: "MODERATE", priority: "NORMAL", assignedOwnerStaffId: staffUserId, dueAt: "2099-01-05T10:00:00.000Z", deduplicateOpenSource: true };
    const createRequest = (idempotencyKey: string, requestBody = body) => new Request("http://localhost/api/escalations", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify(requestBody) });
    const first = await escalationCreateHandler(createRequest(key));
    expect(first.status, JSON.stringify(await first.clone().json())).toBe(201);
    const created = await first.json() as { escalation: { id: string; escalationNumber: string } };
    const replay = await escalationCreateHandler(createRequest(key));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ escalation: { id: created.escalation.id, replayed: true } });
    const duplicateKey = randomUUID();
    const duplicate = await escalationCreateHandler(createRequest(duplicateKey));
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ escalation: { replayed: false, alreadyOpen: true } });
    const duplicateReplay = await escalationCreateHandler(createRequest(duplicateKey));
    expect(duplicateReplay.status).toBe(200);
    expect(await duplicateReplay.json()).toEqual({ escalation: { replayed: true, alreadyOpen: true } });
    const mismatchedDuplicateReplay = await escalationCreateHandler(createRequest(duplicateKey, { ...body, title: "Different synthetic request" }));
    expect(mismatchedDuplicateReplay.status).toBe(409);
    expect(await mismatchedDuplicateReplay.json()).toEqual({ error: "idempotency_conflict" });
    expect((await pool.query("SELECT count(*)::int AS count FROM staff_escalations WHERE organization_id=$1 AND centre_id=$2 AND source_type='APPOINTMENT' AND source_id=$3", [organizationId, centreId, appointment.appointment.id])).rows[0].count).toBe(1);

    const { encryptLeadPrivateData } = await import("@/server/lead-crypto");
    const leadId = randomUUID();
    await pool.query("INSERT INTO leads(id,organization_id,centre_id,lead_number,enquiry_category,source,assigned_staff_id,created_by_staff_id) VALUES($1,$2,$3,$4,'GENERAL','MANUAL',$5,$5)", [leadId, organizationId, centreId, `L-${leadId.slice(0, 8)}`, staffUserId]);
    const leadPrivateData = encryptLeadPrivateData({ firstName: "Synthetic", lastName: "Followup", phone: "+910000000002", email: null, interestedService: null, campaign: null, contactEvidenceReference: null, marketingEvidenceReference: null, lostReason: null }, { organizationId, centreId, recordId: leadId });
    await pool.query("INSERT INTO lead_private_data(lead_id,organization_id,centre_id,payload_ciphertext,phone_blind_index) VALUES($1,$2,$3,$4,$5)", [leadId, organizationId, centreId, leadPrivateData, "1".repeat(64)]);
    const leadFollowupId = randomUUID();
    await pool.query("INSERT INTO lead_followups(id,organization_id,centre_id,lead_id,assigned_staff_id,due_at,created_by_staff_id) VALUES($1,$2,$3,$4,$5,now()+interval '1 day',$5)", [leadFollowupId, organizationId, centreId, leadId, staffUserId]);
    const leadFollowupsResponse = await leadFollowupsHandler(new Request(`http://localhost/api/followups?centreId=${centreId}&followupId=${leadFollowupId}`));
    expect(leadFollowupsResponse.status).toBe(200);
    expect((await leadFollowupsResponse.json() as { followups: Array<{ id: string }> }).followups.map((item) => item.id)).toEqual([leadFollowupId]);
    const leadEscalationKey = randomUUID();
    const leadEscalation = await escalationCreateHandler(new Request("http://localhost/api/escalations", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": leadEscalationKey }, body: JSON.stringify({ centreId, source: { type: "LEAD_FOLLOWUP", id: leadFollowupId }, title: "Synthetic callback needs review", description: "Synthetic CRM follow-up escalation", severity: "MODERATE", priority: "NORMAL", assignedOwnerStaffId: staffUserId, dueAt: "2099-01-06T10:00:00.000Z" }) }));
    expect(leadEscalation.status, JSON.stringify(await leadEscalation.clone().json())).toBe(201);
    const createdLeadEscalation = await leadEscalation.json() as { escalation: { id: string } };
    const storedLeadSource = await pool.query("SELECT source_type,source_id FROM staff_escalations WHERE id=$1", [createdLeadEscalation.escalation.id]);
    expect(storedLeadSource.rows[0]).toEqual({ source_type: "LEAD_FOLLOWUP", source_id: leadFollowupId });
    const referenceResponse = await taskReferencesHandler(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=LEAD_FOLLOWUP`));
    expect(referenceResponse.status).toBe(200);
    expect((await referenceResponse.json() as { references: Array<{ id: string; label: string }> }).references).toContainEqual(expect.objectContaining({ id: leadFollowupId, label: expect.stringContaining(`L-${leadId.slice(0, 8)}`) }));
    const { resolveTaskReference } = await import("@/server/task-reference");
    const leadStaff = { organizationId, staffUserId, grants: [{ key: "leads.followups.manage", centreId }] };
    expect(await resolveTaskReference(leadStaff, centreId, { type: "LEAD_FOLLOWUP", id: leadFollowupId }, { forEscalationCreation: true })).not.toBeNull();
    await pool.query("UPDATE lead_followups SET status='COMPLETED',outcome='CONTACTED',completed_by_staff_id=$2,completed_at=now() WHERE id=$1", [leadFollowupId, staffUserId]);
    expect(await resolveTaskReference(leadStaff, centreId, { type: "LEAD_FOLLOWUP", id: leadFollowupId })).toContain("COMPLETED");

    const relationshipId = randomUUID();
    const relationshipNumber = `RHC-C-SYN-${relationshipId.slice(0, 8)}`;
    await pool.query("INSERT INTO business_relationships(id,organization_id,centre_id,relationship_type,relationship_number,category,status,private_data_ciphertext,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,$3,'CORPORATE',$4,'EMPLOYER','ACTIVE','synthetic-ciphertext',$5,$5)", [relationshipId, organizationId, centreId, relationshipNumber, staffUserId]);
    const corporateReferenceResponse = await taskReferencesHandler(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=CORPORATE_RELATIONSHIP`));
    expect(corporateReferenceResponse.status).toBe(200);
    const corporateReferences = (await corporateReferenceResponse.json() as { references: Array<{ id: string; label: string }> }).references;
    expect(corporateReferences).toContainEqual({ id: relationshipId, label: expect.stringContaining(`${relationshipNumber} · EMPLOYER · ACTIVE`) });
    expect(JSON.stringify(corporateReferences)).not.toContain("synthetic-ciphertext");
    const corporateReader = { organizationId, staffUserId, grants: [{ key: "corporate.read", centreId }] };
    expect(await resolveTaskReference(corporateReader, centreId, { type: "CORPORATE_RELATIONSHIP", id: relationshipId })).toContain(relationshipNumber);
    mocks.getApiAccess.mockImplementation(async (permission: string) => permission === "corporate.read" ? { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) } : { staff: { organizationId, staffUserId, grants }, response: null });
    expect(await resolveTaskReference({ organizationId, staffUserId, grants: [] }, centreId, { type: "CORPORATE_RELATIONSHIP", id: relationshipId })).toBeNull();
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants }, response: null });
    expect(await resolveTaskReference(corporateReader, randomUUID(), { type: "CORPORATE_RELATIONSHIP", id: relationshipId })).toBeNull();
    const relationshipEscalation = await escalationCreateHandler(new Request("http://localhost/api/escalations", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ centreId, source: { type: "CORPORATE_RELATIONSHIP", id: relationshipId }, title: "Synthetic corporate profile issue", description: "Review synthetic relationship administration issue", severity: "LOW", priority: "NORMAL", assignedOwnerStaffId: staffUserId, dueAt: "2099-01-06T12:00:00.000Z" }) }));
    expect(relationshipEscalation.status, JSON.stringify(await relationshipEscalation.clone().json())).toBe(201);
    const relationshipEscalationId = (await relationshipEscalation.json() as { escalation: { id: string } }).escalation.id;
    expect((await pool.query("SELECT source_type,source_id FROM staff_escalations WHERE id=$1", [relationshipEscalationId])).rows[0]).toEqual({ source_type: "CORPORATE_RELATIONSHIP", source_id: relationshipId });

    const doctorId = randomUUID();
    const doctorNumber = `RHC-D-SYN-${doctorId.slice(0, 8)}`;
    const previousDoctorTestKeys = process.env.RUDRA_FIELD_ENCRYPTION_KEYS;
    const previousDoctorActiveKey = process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ synthetic_test_key: Buffer.alloc(32, 9).toString("base64") });
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "synthetic_test_key";
    const { sealDoctorData } = await import("@/server/doctor-data");
    const doctorCiphertext = sealDoctorData({ organizationId, centreId, id: doctorId }, { name: "Synthetic Escalation Doctor", phone: null, email: null, registrationReference: null, affiliation: null, notes: null });
    if (previousDoctorTestKeys === undefined) delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; else process.env.RUDRA_FIELD_ENCRYPTION_KEYS = previousDoctorTestKeys;
    if (previousDoctorActiveKey === undefined) delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; else process.env.RUDRA_FIELD_ACTIVE_KEY_ID = previousDoctorActiveKey;
    await pool.query("INSERT INTO doctor_profiles(id,organization_id,centre_id,doctor_number,specialty,private_data_ciphertext,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,$3,$4,'Synthetic specialty',$5,$6,$6)", [doctorId, organizationId, centreId, doctorNumber, doctorCiphertext, staffUserId]);
    const doctorReferenceResponse = await taskReferencesHandler(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=DOCTOR_RELATIONSHIP`));
    expect(doctorReferenceResponse.status).toBe(200);
    const doctorReferences = (await doctorReferenceResponse.json() as { references: Array<{ id: string; label: string }> }).references;
    expect(doctorReferences).toContainEqual({ id: doctorId, label: expect.stringContaining(`${doctorNumber} · Synthetic specialty · ACTIVE`) });
    expect(JSON.stringify(doctorReferences)).not.toContain("Synthetic Escalation Doctor");
    const doctorReader = { organizationId, staffUserId, grants: [{ key: "doctors.read", centreId }] };
    expect(await resolveTaskReference(doctorReader, centreId, { type: "DOCTOR_RELATIONSHIP", id: doctorId })).toContain(doctorNumber);
    mocks.getApiAccess.mockImplementation(async (permission: string) => permission === "doctors.read" ? { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) } : { staff: { organizationId, staffUserId, grants }, response: null });
    expect(await resolveTaskReference({ organizationId, staffUserId, grants: [] }, centreId, { type: "DOCTOR_RELATIONSHIP", id: doctorId })).toBeNull();
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants }, response: null });
    const doctorEscalation = await escalationCreateHandler(new Request("http://localhost/api/escalations", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ centreId, source: { type: "DOCTOR_RELATIONSHIP", id: doctorId }, title: "Synthetic doctor relationship review", description: "Review synthetic relationship administration issue", severity: "LOW", priority: "NORMAL", assignedOwnerStaffId: staffUserId, dueAt: "2099-01-06T14:00:00.000Z" }) }));
    expect(doctorEscalation.status, JSON.stringify(await doctorEscalation.clone().json())).toBe(201);
    const doctorEscalationId = (await doctorEscalation.json() as { escalation: { id: string } }).escalation.id;
    expect((await pool.query("SELECT source_type,source_id FROM staff_escalations WHERE id=$1", [doctorEscalationId])).rows[0]).toEqual({ source_type: "DOCTOR_RELATIONSHIP", source_id: doctorId });

    const { encryptLeadValue } = await import("@/server/lead-crypto");
    const { publicEnquiryContext } = await import("@/server/public-enquiry-policy");
    const publicEnquiryId = randomUUID();
    const enquiryPayload = { firstName: "Synthetic", lastName: "Website Contact", phone: "+910000000003", email: "private-enquiry@invalid.test", category: "GENERAL", message: "Synthetic website enquiry details", requestKind: "INQUIRY", requestedService: null, preferredDate: null, preferredTimeWindow: null, visitType: null, collectionAddress: null, responsePermission: true, responsePermissionTextVersion: "PUBLIC_ENQUIRY_RESPONSE_V1", submittedAt: new Date().toISOString() };
    await pool.query("INSERT INTO public_enquiries(id,organization_id,centre_id,enquiry_number,status,private_data_ciphertext,phone_blind_index,email_blind_index,idempotency_key,request_fingerprint) VALUES($1,$2,$3,$4,'PENDING_REVIEW',$5,NULL,NULL,$6,$7)", [publicEnquiryId, organizationId, centreId, `RHC-W-SYN-${publicEnquiryId.slice(0, 8)}`, encryptLeadValue("private-data", enquiryPayload, publicEnquiryContext({ organizationId, centreId, id: publicEnquiryId })), randomUUID(), "b".repeat(64)]);
    const enquiryReferences = await taskReferencesHandler(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=PUBLIC_ENQUIRY`));
    expect(enquiryReferences.status).toBe(200);
    const enquiryOptions = (await enquiryReferences.json() as { references: Array<{ id: string; label: string }> }).references;
    expect(enquiryOptions).toContainEqual({ id: publicEnquiryId, label: expect.stringContaining("PENDING_REVIEW") });
    expect(JSON.stringify(enquiryOptions)).not.toContain("private-enquiry@invalid.test");
    expect(await resolveTaskReference({ organizationId, staffUserId, grants: [{ key: "leads.read", centreId }] }, centreId, { type: "PUBLIC_ENQUIRY", id: publicEnquiryId })).toContain("PENDING_REVIEW");
    const enquiryEscalationKey = randomUUID();
    const enquiryEscalation = await escalationCreateHandler(new Request("http://localhost/api/escalations", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": enquiryEscalationKey }, body: JSON.stringify({ centreId, source: { type: "PUBLIC_ENQUIRY", id: publicEnquiryId }, title: "Synthetic website enquiry follow-up", description: "Review the pending synthetic submission", severity: "LOW", priority: "NORMAL", assignedOwnerStaffId: staffUserId, dueAt: "2099-01-07T10:00:00.000Z" }) }));
    expect(enquiryEscalation.status, JSON.stringify(await enquiryEscalation.clone().json())).toBe(201);
    const enquiryEscalationId = (await enquiryEscalation.json() as { escalation: { id: string } }).escalation.id;
    expect((await pool.query("SELECT source_type,source_id FROM staff_escalations WHERE id=$1", [enquiryEscalationId])).rows[0]).toEqual({ source_type: "PUBLIC_ENQUIRY", source_id: publicEnquiryId });
    await pool.query("UPDATE public_enquiries SET status='CONVERTED_TO_LEAD',reviewed_by_staff_id=$2,reviewed_at=now(),resulting_lead_id=$3,version_number=version_number+1 WHERE id=$1", [publicEnquiryId, staffUserId, leadId]);
    expect(await resolveTaskReference({ organizationId, staffUserId, grants: [{ key: "leads.read", centreId }] }, centreId, { type: "PUBLIC_ENQUIRY", id: publicEnquiryId })).toContain("CONVERTED_TO_LEAD");
    mocks.getApiAccess.mockImplementation(async (permission: string) => permission === "leads.read" ? { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) } : { staff: { organizationId, staffUserId, grants }, response: null });
    expect(await resolveTaskReference({ organizationId, staffUserId, grants: [] }, centreId, { type: "PUBLIC_ENQUIRY", id: publicEnquiryId })).toBeNull();

    mocks.getApiAccess.mockImplementation(async (permission: string) => permission === "leads.followups.manage" ? { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) } : { staff: { organizationId, staffUserId, grants }, response: null });
    expect(await resolveTaskReference({ organizationId, staffUserId, grants: [] }, centreId, { type: "LEAD_FOLLOWUP", id: leadFollowupId })).toBeNull();
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants }, response: null });

    const action = (payload: Record<string, unknown>, idempotencyKey = randomUUID()) => new Request(`http://localhost/api/escalations/${created.escalation.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify(payload) });
    mocks.getApiAccess.mockImplementation(async (permission: string) => permission === "escalations.manage" ? { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null } : { staff: { organizationId, staffUserId, grants: grants.filter((grant) => grant.key !== "escalations.manage") }, response: null });
    const unauthorizedUpdate = await escalationActionHandler(action({ action: "UPDATE", expectedVersion: 1, priority: "HIGH", reason: "Unauthorized synthetic update" }), { params: Promise.resolve({ id: created.escalation.id }) });
    expect(unauthorizedUpdate.status).toBe(403);
    mocks.getApiAccess.mockImplementation(async () => ({ staff: { organizationId, staffUserId, grants }, response: null }));
    const invalidDue = await escalationActionHandler(action({ action: "UPDATE", expectedVersion: 1, dueAt: "2000-01-01T00:00:00.000Z", reason: "Invalid synthetic past due" }), { params: Promise.resolve({ id: created.escalation.id }) });
    expect(invalidDue.status).toBe(400);
    expect(await invalidDue.json()).toEqual({ error: "due_date_must_be_future" });
    const acknowledgeKey = randomUUID();
    const acknowledge = await escalationActionHandler(action({ action: "ACKNOWLEDGE", expectedVersion: 1 }, acknowledgeKey), { params: Promise.resolve({ id: created.escalation.id }) });
    expect(acknowledge.status).toBe(200);
    expect(await acknowledge.json()).toMatchObject({ escalation: { id: created.escalation.id, status: "ACKNOWLEDGED", versionNumber: 2 } });
    const acknowledgeReplay = await escalationActionHandler(action({ action: "ACKNOWLEDGE", expectedVersion: 1 }, acknowledgeKey), { params: Promise.resolve({ id: created.escalation.id }) });
    expect(acknowledgeReplay.status).toBe(200);
    expect(await acknowledgeReplay.json()).toMatchObject({ escalation: { id: created.escalation.id, status: "ACKNOWLEDGED", versionNumber: 2, replayed: true } });
    const reusedKey = await escalationActionHandler(action({ action: "COMMENT", expectedVersion: 2, comment: "Different action" }, acknowledgeKey), { params: Promise.resolve({ id: created.escalation.id }) });
    expect(reusedKey.status).toBe(409);
    expect(await reusedKey.json()).toEqual({ error: "idempotency_conflict" });
    const update = await escalationActionHandler(action({ action: "UPDATE", expectedVersion: 2, severity: "HIGH", priority: "URGENT", dueAt: "2099-02-01T10:00:00.000Z", reason: "Synthetic deadline and priority reviewed" }), { params: Promise.resolve({ id: created.escalation.id }) });
    expect(update.status).toBe(200);
    expect(await update.json()).toMatchObject({ escalation: { id: created.escalation.id, status: "ACKNOWLEDGED", versionNumber: 3 } });
    const resolve = await escalationActionHandler(action({ action: "RESOLVE", expectedVersion: 3, reason: "Synthetic blocker resolved" }), { params: Promise.resolve({ id: created.escalation.id }) });
    expect(resolve.status).toBe(200);
    expect(await resolve.json()).toMatchObject({ escalation: { id: created.escalation.id, status: "RESOLVED", versionNumber: 4 } });
    const staleRetry = await escalationActionHandler(action({ action: "RESOLVE", expectedVersion: 3, reason: "Synthetic blocker resolved" }), { params: Promise.resolve({ id: created.escalation.id }) });
    expect(staleRetry.status).toBe(409);
    expect(await staleRetry.json()).toEqual({ error: "version_conflict" });
    const nextOwnerId = randomUUID(); const nextOwnerAuthId = randomUUID();
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [nextOwnerAuthId, "Synthetic Escalation Manager", `${nextOwnerAuthId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [nextOwnerId, nextOwnerAuthId, organizationId, `ST-${nextOwnerId.slice(0, 8)}`, "Synthetic Escalation Manager"]);
    await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, nextOwnerId, workloadRole.rows[0].id, centreId]);
    const invalidReopenDue = await escalationActionHandler(action({ action: "REOPEN", expectedVersion: 4, dueAt: "2000-01-01T00:00:00.000Z", reason: "Synthetic follow-up evidence received" }), { params: Promise.resolve({ id: created.escalation.id }) });
    expect(invalidReopenDue.status).toBe(400);
    expect(await invalidReopenDue.json()).toEqual({ error: "due_date_must_be_future" });
    const reopenedDueAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const reopened = await escalationActionHandler(action({ action: "REOPEN", expectedVersion: 4, dueAt: reopenedDueAt, reason: "Synthetic follow-up evidence received" }), { params: Promise.resolve({ id: created.escalation.id }) });
    expect(reopened.status).toBe(200);
    expect(await reopened.json()).toMatchObject({ escalation: { status: "OPEN", versionNumber: 5 } });
    expect((await pool.query("SELECT due_at FROM staff_escalations WHERE id=$1", [created.escalation.id])).rows[0].due_at.toISOString()).toBe(reopenedDueAt);
    const reassigned = await escalationActionHandler(action({ action: "REASSIGN", expectedVersion: 5, assignedOwnerStaffId: nextOwnerId, reason: "Synthetic workload reassignment" }), { params: Promise.resolve({ id: created.escalation.id }) });
    expect(reassigned.status).toBe(200);
    expect(await reassigned.json()).toMatchObject({ escalation: { status: "OPEN", versionNumber: 6 } });
    const cancelled = await escalationActionHandler(action({ action: "CANCEL", expectedVersion: 6, reason: "Synthetic duplicate issue closed" }), { params: Promise.resolve({ id: created.escalation.id }) });
    expect(cancelled.status).toBe(200);
    expect(await cancelled.json()).toMatchObject({ escalation: { status: "CANCELLED", versionNumber: 7 } });
    const duplicateReplayAfterClose = await escalationCreateHandler(createRequest(duplicateKey));
    expect(duplicateReplayAfterClose.status).toBe(200);
    expect(await duplicateReplayAfterClose.json()).toEqual({ escalation: { replayed: true, alreadyOpen: true } });
    const read = await escalationReadHandler(new Request(`http://localhost/api/escalations/${created.escalation.id}`), { params: Promise.resolve({ id: created.escalation.id }) });
    expect(read.status).toBe(200);
    const result = await read.json() as { history: Array<{ eventType: string; recordedAt: string }> };
    expect(result.history.map((event) => event.eventType)).toEqual(["CREATED", "DUPLICATE_SUPPRESSED", "ACKNOWLEDGED", "UPDATED", "RESOLVED", "REOPENED", "REASSIGNED", "CANCELLED"]);
    expect(result.history.every((event) => !Number.isNaN(Date.parse(event.recordedAt)))).toBe(true);
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    const seededHistoryIds: string[] = [];
    for (let index = 0; index < 101; index += 1) {
      const eventId = randomUUID(); seededHistoryIds.push(eventId);
      const privateData = encryptOperationalData({ comment: `Synthetic escalation history ${index}` }, operationalContext({ organizationId, centreId, recordId: eventId }, "staff-escalation-event"));
      await pool.query("INSERT INTO staff_escalation_events(id,organization_id,centre_id,escalation_id,event_type,private_data_ciphertext,actor_staff_id,recorded_at) VALUES($1,$2,$3,$4,'COMMENTED',$5,$6,now()+make_interval(secs => $7))", [eventId, organizationId, centreId, created.escalation.id, privateData, staffUserId, index]);
    }
    const historyPageOne = await escalationReadHandler(new Request(`http://localhost/api/escalations/${created.escalation.id}?historyPage=1`), { params: Promise.resolve({ id: created.escalation.id }) });
    const historyOneBody = await historyPageOne.json() as { historyPage: number; historyPageSize: number; historyHasMore: boolean; history: Array<{ id: string; comment?: string }> };
    expect(historyOneBody).toMatchObject({ historyPage: 1, historyPageSize: 100, historyHasMore: true });
    expect(historyOneBody.history).toHaveLength(100);
    expect(historyOneBody.history[0].comment).toBe("Synthetic escalation history 1");
    const historyPageTwo = await escalationReadHandler(new Request(`http://localhost/api/escalations/${created.escalation.id}?historyPage=2`), { params: Promise.resolve({ id: created.escalation.id }) });
    const historyTwoBody = await historyPageTwo.json() as { historyPage: number; historyHasMore: boolean; history: Array<{ id: string }> };
    expect(historyTwoBody).toMatchObject({ historyPage: 2, historyHasMore: false });
    expect(historyTwoBody.history).toHaveLength(9);
    const allHistoryIds = [...historyOneBody.history.map((event) => event.id), ...historyTwoBody.history.map((event) => event.id)];
    expect(new Set(allHistoryIds).size).toBe(109);
    expect(seededHistoryIds.every((eventId) => allHistoryIds.includes(eventId))).toBe(true);
    const invalidHistoryPage = await escalationReadHandler(new Request(`http://localhost/api/escalations/${created.escalation.id}?historyPage=0`), { params: Promise.resolve({ id: created.escalation.id }) });
    expect(invalidHistoryPage.status).toBe(400);
    const persisted = await pool.query("SELECT (SELECT count(*)::int FROM staff_escalations WHERE idempotency_key=$1 AND organization_id=$2) AS created_count, (SELECT count(*)::int FROM staff_escalations WHERE organization_id=$2 AND centre_id=$3 AND source_type='APPOINTMENT' AND source_id=$4 AND status IN ('OPEN','ACKNOWLEDGED')) AS open_source_count, (SELECT count(*)::int FROM staff_escalation_events WHERE escalation_id=$5) AS event_count, (SELECT status FROM staff_escalations WHERE id=$5) AS status, (SELECT assigned_owner_staff_id FROM staff_escalations WHERE id=$5) AS owner_id", [key, organizationId, centreId, appointment.appointment.id, created.escalation.id]);
    expect(persisted.rows[0]).toEqual({ created_count: 1, open_source_count: 0, event_count: 109, status: "CANCELLED", owner_id: nextOwnerId });
    const createIndependentEscalation = async (scheduledLocal: string, label: string) => {
      const bookingResponse = await handler(new Request("http://localhost/api/appointments", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ centreId, patientId, source: "STAFF", visitType: "CENTRE", scheduledLocal, durationMinutes: 30, services: [{ type: "OTHER", name: label }] }) }));
      expect(bookingResponse.status).toBe(201);
      const booking = await bookingResponse.json() as { appointment: { id: string } };
      const response = await escalationCreateHandler(new Request("http://localhost/api/escalations", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ ...body, source: { type: "APPOINTMENT", id: booking.appointment.id }, title: label }) }));
      expect(response.status).toBe(201);
      return (await response.json() as { escalation: { id: string } }).escalation.id;
    };
    const firstIndependentId = await createIndependentEscalation("2099-01-07T09:00", "Synthetic concurrent escalation A");
    const secondIndependentId = await createIndependentEscalation("2099-01-07T10:00", "Synthetic concurrent escalation B");
    const sharedActionKey = randomUUID();
    const commentRequest = (escalationId: string, comment: string) => new Request(`http://localhost/api/escalations/${escalationId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": sharedActionKey }, body: JSON.stringify({ action: "COMMENT", expectedVersion: 1, comment }) });
    const concurrentActions = await Promise.all([
      escalationActionHandler(commentRequest(firstIndependentId, "Synthetic concurrent comment A"), { params: Promise.resolve({ id: firstIndependentId }) }),
      escalationActionHandler(commentRequest(secondIndependentId, "Synthetic concurrent comment B"), { params: Promise.resolve({ id: secondIndependentId }) }),
    ]);
    expect(concurrentActions.map((response) => response.status).sort()).toEqual([200, 409]);
    const concurrentErrors = await Promise.all(concurrentActions.map((response) => response.status === 409 ? response.json() : null));
    expect(concurrentErrors).toContainEqual({ error: "idempotency_conflict" });
    const oneActionEvent = await pool.query("SELECT count(*)::int AS count FROM staff_escalation_events WHERE organization_id=$1 AND idempotency_key=$2", [organizationId, sharedActionKey]);
    expect(oneActionEvent.rows[0].count).toBe(1);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }, { key: "appointments.update", centreId }, { key: "appointments.assign", centreId }, { key: "roster.read", centreId }, { key: "finance.read", centreId }] }, response: null });
  });

  it("limits the phlebotomist collection queue to assigned jobs in granted centres", async () => {
    const otherStaffId = randomUUID(); const otherAuthId = randomUUID(); const otherCentreId = randomUUID(); const otherPatientId = randomUUID();
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [otherAuthId, "Synthetic Other Collector", `${otherAuthId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [otherStaffId, otherAuthId, organizationId, `ST-${otherStaffId.slice(0, 8)}`, "Synthetic Other Collector"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [otherCentreId, organizationId, `X-${otherCentreId.slice(0, 8)}`, "Synthetic Restricted Centre"]);
    await pool.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',$5)", [otherPatientId, organizationId, otherCentreId, `P-${otherPatientId.slice(0, 8)}`, staffUserId]);
    const { encryptPatientContacts, encryptPatientIdentity } = await import("@/server/patient-contact-crypto");
    const otherContext = { organizationId, centreId: otherCentreId, patientId: otherPatientId };
    const otherIdentity = encryptPatientIdentity({ firstName: "Restricted", lastName: "Synthetic Patient" }, otherContext);
    const otherContact = encryptPatientContacts({ phone: "+910000000002", email: null, profile: { dateOfBirth: "1985-01-01", sexAtRegistration: null, address: null, preferredName: null } }, otherContext);
    await pool.query("INSERT INTO patient_contact_secrets(patient_id,organization_id,centre_id,encryption_key_id,phone_ciphertext,email_ciphertext,profile_ciphertext,name_ciphertext,phone_blind_index,email_blind_index,first_name_blind_index,last_name_blind_index,full_name_blind_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [otherPatientId, organizationId, otherCentreId, otherContact.encryptionKeyId, otherContact.phoneCiphertext, otherContact.emailCiphertext, otherContact.profileCiphertext, otherIdentity.nameCiphertext, otherContact.phoneBlindIndex, otherContact.emailBlindIndex, otherIdentity.firstNameBlindIndex, otherIdentity.lastNameBlindIndex, otherIdentity.fullNameBlindIndex]);
    const secondAppointmentResponse = await handler(new Request("http://localhost/api/appointments", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ centreId: otherCentreId, patientId: otherPatientId, source: "STAFF", visitType: "CENTRE", scheduledLocal: "2099-01-05T12:00", durationMinutes: 30, services: [{ type: "OTHER", name: "SYNTHETIC-QUEUE-SERVICE" }] }) }));
    expect(secondAppointmentResponse.status).toBe(201);
    const secondAppointment = await secondAppointmentResponse.json() as { appointment: { id: string } };
    const mainAppointmentResponse = await handler(request(randomUUID()));
    expect(mainAppointmentResponse.status).toBe(201);
    const mainAppointment = await mainAppointmentResponse.json() as { appointment: { id: string } };
    const secondMainAppointmentResponse = await handler(new Request("http://localhost/api/appointments", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ centreId, patientId, source: "STAFF", visitType: "CENTRE", scheduledLocal: "2099-01-05T13:00", durationMinutes: 30, services: [{ type: "OTHER", name: "SYNTHETIC-QUEUE-SERVICE-2" }] }) }));
    expect(secondMainAppointmentResponse.status).toBe(201);
    const secondMainAppointment = await secondMainAppointmentResponse.json() as { appointment: { id: string } };
    const insertOrder = async (centre: string, patient: string, appointment: string) => {
      const orderId = randomUUID();
      await pool.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [orderId, organizationId, centre, `O-${orderId.slice(0, 8)}`, patient, appointment, randomUUID(), "d".repeat(64), staffUserId]);
      return orderId;
    };
    const mainOrderId = await insertOrder(centreId, patientId, mainAppointment.appointment.id);
    const otherOrderId = await insertOrder(otherCentreId, otherPatientId, secondAppointment.appointment.id);
    const insertJob = async (centre: string, patient: string, appointment: string, order: string, assignedStaff: string) => {
      const id = randomUUID();
      await pool.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,assigned_staff_id,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'ASSIGNED',$8,$9,$10,$11,$12)", [id, organizationId, centre, `J-${id.slice(0, 8)}`, appointment, order, patient, assignedStaff, "2099-01-05T05:00:00Z", "2099-01-05T05:30:00Z", randomUUID(), staffUserId]);
      return id;
    };
    const assignedJobId = await insertJob(centreId, patientId, mainAppointment.appointment.id, mainOrderId, staffUserId);
    const secondMainOrderId = await insertOrder(centreId, patientId, secondMainAppointment.appointment.id);
    const unrelatedJobId = await insertJob(centreId, patientId, secondMainAppointment.appointment.id, secondMainOrderId, otherStaffId);
    const crossCentreJobId = await insertJob(otherCentreId, otherPatientId, secondAppointment.appointment.id, otherOrderId, staffUserId);
    const grants = [{ key: "collections.read", centreId }, { key: "collections.visit.record", centreId }];
    const collector = { organizationId, staffUserId, grants };
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => grants.some((grant) => grant.key === permission && (!requestedCentre || grant.centreId === null || grant.centreId === requestedCentre))
      ? { staff: collector, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const queue = await collectionListHandler(new Request("http://localhost/api/collections"));
    expect(queue.status).toBe(200);
    const queueBody = await queue.json() as { jobs: Array<{ id: string; patientName: string }> };
    expect(queueBody.jobs.map((job) => job.id)).toEqual([assignedJobId]);
    expect(JSON.stringify(queueBody)).not.toContain("Restricted Synthetic Patient");
    const dailyQueueResponse = await collectionListHandler(new Request("http://localhost/api/collections?date=2099-01-05"));
    expect(dailyQueueResponse.status).toBe(200);
    const dailyQueueBody = await dailyQueueResponse.json() as { jobs: Array<{ id: string; centreTimeZone: string }>; summary: { total: number } };
    expect(dailyQueueBody.jobs.map((job) => job.id)).toEqual([assignedJobId]);
    expect(dailyQueueBody.jobs[0].centreTimeZone).toBe("Asia/Kolkata");
    expect(dailyQueueBody.summary.total).toBe(1);
    const nextDayQueue = await collectionListHandler(new Request("http://localhost/api/collections?date=2099-01-06"));
    expect(await nextDayQueue.json()).toMatchObject({ jobs: [], summary: { total: 0 } });
    expect((await collectionListHandler(new Request("http://localhost/api/collections?date=2099-02-30"))).status).toBe(400);
    const detail = async (id: string) => import("../collections/[id]/route").then(({ GET }) => GET(new Request(`http://localhost/api/collections/${id}`), { params: Promise.resolve({ id }) }));
    expect((await detail(unrelatedJobId)).status).toBe(404);
    expect((await detail(crossCentreJobId)).status).toBe(403);
    const visitOnlyGrants = [{ key: "collections.visit.record", centreId }];
    const visitOnlyCollector = { organizationId, staffUserId, grants: visitOnlyGrants };
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => visitOnlyGrants.some((grant) => grant.key === permission && (!requestedCentre || grant.centreId === null || grant.centreId === requestedCentre))
      ? { staff: visitOnlyCollector, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const visitOnlyQueue = await collectionListHandler(new Request("http://localhost/api/collections"));
    expect(visitOnlyQueue.status).toBe(200);
    const visitOnlyBody = await visitOnlyQueue.json() as { jobs: Array<{ id: string; patientName: string }> };
    expect(visitOnlyBody.jobs.map((job) => job.id)).toEqual([assignedJobId]);
    expect(JSON.stringify(visitOnlyBody)).not.toContain("Restricted Synthetic Patient");
    expect((await detail(assignedJobId)).status).toBe(200);
    expect((await detail(unrelatedJobId)).status).toBe(404);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.create", centreId: null }, { key: "patients.read", centreId: null }] }, response: null });
    const secondOtherCentreAppointmentResponse = await handler(new Request("http://localhost/api/appointments", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ centreId: otherCentreId, patientId: otherPatientId, source: "STAFF", visitType: "CENTRE", scheduledLocal: "2099-01-05T14:00", durationMinutes: 30, services: [{ type: "OTHER", name: "SYNTHETIC-MIXED-SCOPE-SERVICE" }] }) }));
    expect(secondOtherCentreAppointmentResponse.status).toBe(201);
    const secondOtherCentreAppointment = await secondOtherCentreAppointmentResponse.json() as { appointment: { id: string } };
    const mixedScopeOrderId = await insertOrder(otherCentreId, otherPatientId, secondOtherCentreAppointment.appointment.id);
    const assignedOutsideManagementCentre = await insertJob(otherCentreId, otherPatientId, secondOtherCentreAppointment.appointment.id, mixedScopeOrderId, staffUserId);
    await pool.query("UPDATE collection_jobs SET assigned_staff_id=$2 WHERE id=$1", [crossCentreJobId, otherStaffId]);
    const mixedGrants = [
      { key: "collections.read", centreId }, { key: "collections.read", centreId: otherCentreId },
      { key: "collections.visit.record", centreId: null }, { key: "collections.assign", centreId },
    ];
    const mixedCollector = { organizationId, staffUserId, grants: mixedGrants };
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => mixedGrants.some((grant) => grant.key === permission && (!requestedCentre || grant.centreId === null || grant.centreId === requestedCentre))
      ? { staff: mixedCollector, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const mixedQueue = await collectionListHandler(new Request("http://localhost/api/collections"));
    expect(mixedQueue.status).toBe(200);
    const mixedQueueBody = await mixedQueue.json() as { jobs: Array<{ id: string }>; summary: { total: number; byStatus: Record<string, number> } };
    expect(mixedQueueBody.jobs.map((job) => job.id)).toEqual(expect.arrayContaining([assignedJobId, unrelatedJobId, assignedOutsideManagementCentre]));
    expect(mixedQueueBody.jobs.map((job) => job.id)).not.toContain(crossCentreJobId);
    expect(mixedQueueBody.summary).toEqual({ total: 3, byStatus: { ASSIGNED: 3 }, byVisitStage: { travelling: 0, arrived: 0, inProgressUnstaged: 0 } });
    const selectedCentreQueueResponse = await collectionListHandler(new Request(`http://localhost/api/collections?centreId=${otherCentreId}`));
    expect(selectedCentreQueueResponse.status).toBe(200);
    const selectedCentreQueue = await selectedCentreQueueResponse.json() as { jobs: Array<{ id: string }>; summary: { total: number } };
    expect(selectedCentreQueue.jobs.map((job) => job.id)).toEqual([assignedOutsideManagementCentre]);
    expect(selectedCentreQueue.summary.total).toBe(1);
    expect((await collectionListHandler(new Request("http://localhost/api/collections?centreId=not-a-uuid"))).status).toBe(400);
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => grants.some((grant) => grant.key === permission && (!requestedCentre || grant.centreId === null || grant.centreId === requestedCentre))
      ? { staff: collector, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    expect((await collectionListHandler(new Request(`http://localhost/api/collections?centreId=${otherCentreId}`))).status).toBe(403);
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => mixedGrants.some((grant) => grant.key === permission && (!requestedCentre || grant.centreId === null || grant.centreId === requestedCentre))
      ? { staff: mixedCollector, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const mixedDailyQueue = await collectionListHandler(new Request("http://localhost/api/collections?date=2099-01-05"));
    const mixedDailyBody = await mixedDailyQueue.json() as { jobs: Array<{ id: string }>; summary: { total: number } };
    expect(mixedDailyBody.summary.total).toBe(3);
    expect(mixedDailyBody.jobs.map((job) => job.id)).not.toContain(crossCentreJobId);
    const collectionPageOne = await (await collectionListHandler(new Request("http://localhost/api/collections?page=1&pageSize=1"))).json() as { jobs: Array<{ id: string }>; page: number; hasMore: boolean };
    const collectionPageTwo = await (await collectionListHandler(new Request("http://localhost/api/collections?page=2&pageSize=1"))).json() as { jobs: Array<{ id: string }>; page: number; hasMore: boolean };
    expect(collectionPageOne).toMatchObject({ page: 1, hasMore: true });
    expect(collectionPageTwo).toMatchObject({ page: 2, hasMore: true });
    expect(collectionPageTwo.jobs[0].id).not.toBe(collectionPageOne.jobs[0].id);

    const insertSpecimen = async (jobId: string, centre: string, patient: string, order: string, receivingSubmissionRequired = false) => {
      const procedureId = randomUUID();
      const specimenId = randomUUID();
      await pool.query("INSERT INTO sample_procedure_approvals(id,organization_id,centre_id,operation,reference,status,approved_by_staff_id) VALUES($1,$2,$3,'COLLECTION',$4,'ACTIVE',$5)", [procedureId, organizationId, centre, `SYNTH-COLLECTION-${specimenId.slice(0, 8)}`, staffUserId]);
      const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
      const privateData = encryptOperationalData({ specimenType: "Synthetic specimen", requirementReference: "SYNTHETIC-REQUIREMENT" }, operationalContext({ organizationId, centreId: centre, recordId: specimenId }, "specimen"));
      await pool.query("INSERT INTO specimens(id,organization_id,centre_id,job_id,order_id,patient_id,specimen_number,idempotency_key,private_data_ciphertext,status,identity_check_confirmed,collection_procedure_approval_id,collected_by_staff_id,receiving_submission_required) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'COLLECTED',true,$10,$11,$12)", [specimenId, organizationId, centre, jobId, order, patient, `SP-${specimenId.slice(0, 8)}`, randomUUID(), privateData, procedureId, staffUserId, receivingSubmissionRequired]);
      return specimenId;
    };
    const mainAssignedSpecimen = await insertSpecimen(assignedJobId, centreId, patientId, mainOrderId, true);
    const handoverSubmissionSpecimen = mainAssignedSpecimen;
    const mainManagedSpecimen = await insertSpecimen(unrelatedJobId, centreId, patientId, secondMainOrderId);
    const otherAssignedSpecimen = await insertSpecimen(assignedOutsideManagementCentre, otherCentreId, otherPatientId, mixedScopeOrderId);
    const otherStaffSpecimen = await insertSpecimen(crossCentreJobId, otherCentreId, otherPatientId, otherOrderId);
    const insertSampleException = async (specimenId: string, centre: string) => {
      const id = randomUUID();
      const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
      const privateDataCiphertext = encryptOperationalData({ reason: "Synthetic visibility integration fixture", resolutionReference: null }, operationalContext({ organizationId, centreId: centre, recordId: id }, "sample-exception"));
      await pool.query("INSERT INTO sample_exceptions(id,organization_id,centre_id,specimen_id,exception_type,private_data_ciphertext,status,recorded_by_staff_id) VALUES($1,$2,$3,$4,'OTHER',$5,'OPEN',$6)", [id, organizationId, centre, specimenId, privateDataCiphertext, staffUserId]);
      return id;
    };
    const assignedExceptionId = await insertSampleException(mainAssignedSpecimen, centreId);
    const unrelatedExceptionId = await insertSampleException(mainManagedSpecimen, centreId);
    const crossCentreExceptionId = await insertSampleException(otherAssignedSpecimen, otherCentreId);
    const { resolveTaskReference } = await import("@/server/task-reference");
    const assignedSampleReader = { organizationId, staffUserId, grants: [{ key: "samples.read", centreId }, { key: "samples.collect", centreId }] };
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => assignedSampleReader.grants.some((grant) => grant.key === permission && (!requestedCentre || grant.centreId === null || grant.centreId === requestedCentre))
      ? { staff: assignedSampleReader, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    expect(await resolveTaskReference(assignedSampleReader, centreId, { type: "SAMPLE_EXCEPTION", id: assignedExceptionId })).toContain("OPEN");
    expect(await resolveTaskReference(assignedSampleReader, centreId, { type: "SAMPLE_EXCEPTION", id: unrelatedExceptionId })).toBeNull();
    expect(await resolveTaskReference(assignedSampleReader, otherCentreId, { type: "SAMPLE_EXCEPTION", id: crossCentreExceptionId })).toBeNull();
    const assignedExceptionPickerResponse = await taskReferencesHandler(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=SAMPLE_EXCEPTION`));
    const assignedExceptionPicker = await assignedExceptionPickerResponse.json() as { references: Array<{ id: string }> };
    expect(assignedExceptionPickerResponse.status).toBe(200);
    expect(assignedExceptionPicker.references.map((row) => row.id)).toContain(assignedExceptionId);
    expect(assignedExceptionPicker.references.map((row) => row.id)).not.toContain(unrelatedExceptionId);
    const managerSampleReader = { organizationId, staffUserId, grants: [...assignedSampleReader.grants, { key: "collections.assign", centreId }] };
    mocks.getApiAccess.mockResolvedValue({ staff: managerSampleReader, response: null });
    const managerExceptionPickerResponse = await taskReferencesHandler(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=SAMPLE_EXCEPTION`));
    const managerExceptionPicker = await managerExceptionPickerResponse.json() as { references: Array<{ id: string }> };
    expect(managerExceptionPicker.references.map((row) => row.id)).toEqual(expect.arrayContaining([assignedExceptionId, unrelatedExceptionId]));
    const visitOnlyPickerGrants = [{ key: "collections.visit.record", centreId }];
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => visitOnlyPickerGrants.some((grant) => grant.key === permission && (!requestedCentre || grant.centreId === null || grant.centreId === requestedCentre))
      ? { staff: { organizationId, staffUserId, grants: visitOnlyPickerGrants }, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const visitOnlyJobPickerResponse = await taskReferencesHandler(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=COLLECTION_JOB`));
    const visitOnlyJobPicker = await visitOnlyJobPickerResponse.json() as { references: Array<{ id: string }> };
    expect(visitOnlyJobPickerResponse.status).toBe(200);
    expect(visitOnlyJobPicker.references.map((row) => row.id)).toEqual([assignedJobId]);
    const specimenGrants = [
      { key: "samples.read", centreId }, { key: "samples.read", centreId: otherCentreId },
      { key: "samples.collect", centreId: null }, { key: "collections.assign", centreId },
      { key: "patients.read", centreId },
    ];
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: specimenGrants }, response: null });
    const specimensResponse = await specimenListHandler(new Request("http://localhost/api/samples"));
    expect(specimensResponse.status).toBe(200);
    const specimensBody = await specimensResponse.json() as { specimens: Array<{ id: string; centreId: string; specimenType: string; requirementReference: string; patientId?: string; patientName?: string }> };
    expect(specimensBody.specimens.map((specimen) => specimen.id)).toEqual(expect.arrayContaining([mainAssignedSpecimen, mainManagedSpecimen, otherAssignedSpecimen]));
    expect(specimensBody.specimens.map((specimen) => specimen.id)).not.toContain(otherStaffSpecimen);
    expect(specimensBody.specimens.find((specimen) => specimen.id === mainAssignedSpecimen)).toMatchObject({ centreId, specimenType: "Synthetic specimen", requirementReference: "SYNTHETIC-REQUIREMENT", patientId, patientName: "Synthetic" });
    expect(specimensBody.specimens.find((specimen) => specimen.id === otherAssignedSpecimen)).not.toHaveProperty("patientId");
    expect(specimensBody.specimens.find((specimen) => specimen.id === otherAssignedSpecimen)).not.toHaveProperty("patientName");
    const pendingHandoverResponse = await specimenListHandler(new Request("http://localhost/api/samples?view=handover"));
    expect(pendingHandoverResponse.status).toBe(200);
    const pendingHandoverBody = await pendingHandoverResponse.json() as { specimens: Array<{ id: string; status: string }> };
    expect(pendingHandoverBody.specimens.map((specimen) => specimen.id)).toEqual(expect.arrayContaining([mainAssignedSpecimen, mainManagedSpecimen, otherAssignedSpecimen]));
    expect(pendingHandoverBody.specimens.map((specimen) => specimen.id)).not.toContain(otherStaffSpecimen);
    expect(pendingHandoverBody.specimens.every((specimen) => specimen.status === "COLLECTED")).toBe(true);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "samples.read", centreId: null }, { key: "collections.visit.record", centreId: null }] }, response: null });
    const fieldStaffHandoverResponse = await specimenListHandler(new Request("http://localhost/api/samples?view=handover"));
    const fieldStaffHandoverBody = await fieldStaffHandoverResponse.json() as { specimens: Array<{ id: string; patientId?: string; patientName?: string }> };
    expect(fieldStaffHandoverBody.specimens.map((specimen) => specimen.id)).toEqual(expect.arrayContaining([mainAssignedSpecimen, otherAssignedSpecimen]));
    expect(fieldStaffHandoverBody.specimens.map((specimen) => specimen.id)).not.toContain(mainManagedSpecimen);
    expect(fieldStaffHandoverBody.specimens.map((specimen) => specimen.id)).not.toContain(otherStaffSpecimen);
    expect(fieldStaffHandoverBody.specimens.every((specimen) => !("patientId" in specimen) && !("patientName" in specimen))).toBe(true);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId: otherStaffId, grants: [{ key: "samples.read", centreId }, { key: "samples.receive", centreId }] }, response: null });
    const receivingBeforeSubmission = await specimenListHandler(new Request("http://localhost/api/samples?view=receiving"));
    expect(((await receivingBeforeSubmission.json()) as { specimens: Array<{ id: string }> }).specimens.map((specimen) => specimen.id)).not.toContain(handoverSubmissionSpecimen);
    const receivingProcedureId = randomUUID();
    await pool.query("INSERT INTO sample_procedure_approvals(id,organization_id,centre_id,operation,reference,status,approved_by_staff_id) VALUES($1,$2,$3,'RECEIVING',$4,'ACTIVE',$5)", [receivingProcedureId, organizationId, centreId, `SYNTH-RECEIVING-${receivingProcedureId.slice(0, 8)}`, staffUserId]);
    const blockedReceive = await specimenActionHandler(new Request("http://localhost/api/samples", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "receive", specimenId: handoverSubmissionSpecimen, expectedVersion: 1, procedureApprovalId: receivingProcedureId, reason: "Synthetic receiving reconciliation" }) }));
    expect(blockedReceive.status).toBe(409);
    expect(await blockedReceive.json()).toEqual({ error: "receiving_submission_required" });
    expect((await pool.query("SELECT status,version_number FROM specimens WHERE organization_id=$1 AND id=$2", [organizationId, handoverSubmissionSpecimen])).rows[0]).toMatchObject({ status: "COLLECTED", version_number: 1 });
    const submissionGrants = [{ key: "collections.visit.record", centreId }];
    const submissionStaff = { organizationId, staffUserId, grants: submissionGrants };
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => submissionGrants.some((grant) => grant.key === permission && (!requestedCentre || grant.centreId === null || grant.centreId === requestedCentre))
      ? { staff: submissionStaff, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const submissionKey = randomUUID();
    const submissionRequest = () => new Request("http://localhost/api/samples", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": submissionKey }, body: JSON.stringify({ action: "submit_for_receiving", specimenId: handoverSubmissionSpecimen, expectedVersion: 1, reason: "Synthetic handover submitted" }) });
    const submissionResponse = await specimenActionHandler(submissionRequest());
    expect(submissionResponse.status).toBe(200);
    expect(await submissionResponse.json()).toMatchObject({ result: { status: "COLLECTED", versionNumber: 2, handoverSubmitted: true, replayed: false } });
    expect((await specimenActionHandler(submissionRequest()).then((response) => response.json()))).toMatchObject({ result: { handoverSubmitted: true, replayed: true } });
    expect(await pool.query("SELECT event_type,source,idempotency_key FROM sample_custody_events WHERE organization_id=$1 AND specimen_id=$2", [organizationId, handoverSubmissionSpecimen]).then((result) => result.rows)).toEqual([expect.objectContaining({ event_type: "SUBMITTED_FOR_RECEIVING", source: "STAFF_RECORDED", idempotency_key: submissionKey })]);
    const noCentreGrant = [{ key: "collections.visit.record", centreId }];
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => noCentreGrant.some((grant) => grant.key === permission && (!requestedCentre || grant.centreId === null || grant.centreId === requestedCentre))
      ? { staff: submissionStaff, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const unauthorizedSubmission = await specimenActionHandler(new Request("http://localhost/api/samples", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "submit_for_receiving", specimenId: otherStaffSpecimen, expectedVersion: 1, reason: "Synthetic unauthorized attempt" }) }));
    expect(unauthorizedSubmission.status).toBe(404);
    expect((await pool.query("SELECT count(*)::int AS count FROM sample_custody_events WHERE organization_id=$1 AND specimen_id=$2 AND event_type='SUBMITTED_FOR_RECEIVING'", [organizationId, otherStaffSpecimen])).rows[0].count).toBe(0);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId: otherStaffId, grants: [{ key: "samples.read", centreId }, { key: "samples.receive", centreId }] }, response: null });
    const receiptKey = randomUUID();
    const receiveRequest = () => new Request("http://localhost/api/samples", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": receiptKey }, body: JSON.stringify({ action: "receive", specimenId: handoverSubmissionSpecimen, expectedVersion: 2, procedureApprovalId: receivingProcedureId, reason: "Synthetic receiving reconciliation" }) });
    const receiptResponse = await specimenActionHandler(receiveRequest());
    expect(receiptResponse.status).toBe(200);
    expect(await receiptResponse.json()).toMatchObject({ result: { status: "RECEIVED_AT_RUDRA", versionNumber: 3, replayed: false } });
    expect(await (await specimenActionHandler(receiveRequest())).json()).toMatchObject({ result: { status: "RECEIVED_AT_RUDRA", versionNumber: 3, replayed: true } });
    expect((await pool.query("SELECT count(*)::int AS count FROM sample_custody_events WHERE organization_id=$1 AND specimen_id=$2 AND event_type='RECEIVED_AT_RUDRA'", [organizationId, handoverSubmissionSpecimen])).rows[0].count).toBe(1);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: specimenGrants }, response: null });
    const samplePageOne = await (await specimenListHandler(new Request("http://localhost/api/samples?page=1&pageSize=1"))).json() as { specimens: Array<{ id: string }>; page: number; hasMore: boolean };
    const samplePageTwo = await (await specimenListHandler(new Request("http://localhost/api/samples?page=2&pageSize=1"))).json() as { specimens: Array<{ id: string }>; page: number; hasMore: boolean };
    expect(samplePageOne).toMatchObject({ page: 1, hasMore: true });
    expect(samplePageTwo).toMatchObject({ page: 2, hasMore: true });
    expect(samplePageTwo.specimens[0].id).not.toBe(samplePageOne.specimens[0].id);
    const samplePageThree = await (await specimenListHandler(new Request("http://localhost/api/samples?page=3&pageSize=1"))).json() as { specimens: Array<{ id: string }>; page: number; hasMore: boolean };
    expect(samplePageThree).toMatchObject({ page: 3, hasMore: false });
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    const dispatchIds: string[] = [];
    for (const [index, centre] of [centreId, centreId, otherCentreId].entries()) {
      const id = randomUUID(); dispatchIds.push(id);
      const privateData = encryptOperationalData({ carrierReference: null, externalLabReference: null }, operationalContext({ organizationId, centreId: centre, recordId: id }, "dispatch-batch"));
      await pool.query("INSERT INTO dispatch_batches(id,organization_id,centre_id,batch_number,status,private_data_ciphertext,created_by_staff_id,created_at,updated_at) VALUES($1,$2,$3,$4,'PREPARING',$5,$6,$7,$7)", [id, organizationId, centre, `D-${id.slice(0, 8)}`, privateData, staffUserId, new Date(Date.UTC(2099, 0, index + 1))]);
    }
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "samples.read", centreId }] }, response: null });
    const dispatchPageOne = await (await dispatchListHandler(new Request("http://localhost/api/samples/dispatch?page=1&pageSize=1"))).json() as { batches: Array<{ id: string }>; page: number; hasMore: boolean };
    const dispatchPageTwo = await (await dispatchListHandler(new Request("http://localhost/api/samples/dispatch?page=2&pageSize=1"))).json() as { batches: Array<{ id: string }>; page: number; hasMore: boolean };
    expect(dispatchPageOne).toMatchObject({ page: 1, hasMore: true });
    expect(dispatchPageTwo).toMatchObject({ page: 2, hasMore: false });
    expect([dispatchPageOne.batches[0].id, dispatchPageTwo.batches[0].id].sort()).toEqual(dispatchIds.slice(0, 2).sort());
    mocks.getApiAccess.mockReset();
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }, { key: "appointments.update", centreId }, { key: "appointments.assign", centreId }, { key: "roster.read", centreId }, { key: "finance.read", centreId }] }, response: null });
  });

  it("creates and resolves a roster-conflict escalation against a collection job", async () => {
    const bookingResponse = await handler(new Request("http://localhost/api/appointments", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ centreId, patientId, source: "STAFF", visitType: "CENTRE", scheduledLocal: "2099-01-08T11:00", durationMinutes: 30, services: [{ type: "OTHER", name: "SYNTHETIC-ROSTER-CONFLICT-SERVICE" }] }) }));
    expect(bookingResponse.status).toBe(201);
    const booking = await bookingResponse.json() as { appointment: { id: string } };
    const orderId = randomUUID();
    await pool!.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [orderId, organizationId, centreId, `O-${orderId.slice(0, 8)}`, patientId, booking.appointment.id, randomUUID(), "c".repeat(64), staffUserId]);
    const jobId = randomUUID();
    await pool!.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,assigned_staff_id,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'ASSIGNED',$8,'2099-01-08T05:30:00Z','2099-01-08T06:00:00Z',$9,$10)", [jobId, organizationId, centreId, `J-${jobId.slice(0, 8)}`, booking.appointment.id, orderId, patientId, staffUserId, randomUUID(), staffUserId]);
    const role = await pool!.query("SELECT id FROM roles WHERE organization_id=$1 AND key='synthetic_workload'", [organizationId]);
    const permissionId = randomUUID();
    await pool!.query("INSERT INTO permissions(id,key,description,scope) VALUES($1,'escalations.read','Synthetic escalation read permission','CENTRE') ON CONFLICT(key) DO NOTHING", [permissionId]);
    const permission = await pool!.query("SELECT id FROM permissions WHERE key='escalations.read'");
    await pool!.query("INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [role.rows[0].id, permission.rows[0].id]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [
      { key: "workspace.read", centreId }, { key: "escalations.create", centreId }, { key: "escalations.read", centreId }, { key: "collections.read", centreId },
    ] }, response: null });
    const create = await escalationCreateHandler(new Request("http://localhost/api/escalations", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ centreId, source: { type: "COLLECTION_JOB", id: jobId }, title: "Synthetic roster assignment conflict", description: "Review the advisory schedule overlap", severity: "MODERATE", priority: "NORMAL", assignedOwnerStaffId: staffUserId, dueAt: "2099-01-09T10:00:00.000Z" }) }));
    expect(create.status, JSON.stringify(await create.clone().json())).toBe(201);
    const created = await create.json() as { escalation: { id: string } };
    const stored = await pool!.query("SELECT source_type,source_id FROM staff_escalations WHERE id=$1 AND organization_id=$2 AND centre_id=$3", [created.escalation.id, organizationId, centreId]);
    expect(stored.rows[0]).toEqual({ source_type: "COLLECTION_JOB", source_id: jobId });
    const read = await escalationReadHandler(new Request(`http://localhost/api/escalations/${created.escalation.id}`), { params: Promise.resolve({ id: created.escalation.id }) });
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      escalation: {
        source: {
          type: "COLLECTION_JOB",
          id: jobId,
          label: expect.stringContaining(`J-${jobId.slice(0, 8)}`),
        },
      },
    });
    const operationsResponse = await operationsHandler();
    expect(operationsResponse.status).toBe(200);
    const operationsBody = await operationsResponse.json() as { centres: Array<{ id: string; queue: Array<{ id: string; kind: string; href: string }> }> };
    expect(operationsBody.centres.find((item) => item.id === centreId)?.queue).toContainEqual(expect.objectContaining({ id: created.escalation.id, kind: "ESCALATION", href: `/escalations?escalationId=${created.escalation.id}&centreId=${centreId}` }));

    const otherAuthUserId = randomUUID(); const otherStaffId = randomUUID();
    await pool!.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [otherAuthUserId, "Synthetic Other Collector", `${otherAuthUserId}@invalid.test`]);
    await pool!.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [otherStaffId, otherAuthUserId, organizationId, `ST-${otherStaffId.slice(0, 8)}`, "Synthetic Other Collector"]);
    const otherBookingResponse = await handler(new Request("http://localhost/api/appointments", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ centreId, patientId, source: "STAFF", visitType: "CENTRE", scheduledLocal: "2099-01-08T12:00", durationMinutes: 30, services: [{ type: "OTHER", name: "SYNTHETIC-OTHER-COLLECTION-SERVICE" }] }) }));
    expect(otherBookingResponse.status).toBe(201);
    const otherBooking = await otherBookingResponse.json() as { appointment: { id: string } };
    const otherOrderId = randomUUID();
    await pool!.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [otherOrderId, organizationId, centreId, `O-${otherOrderId.slice(0, 8)}`, patientId, otherBooking.appointment.id, randomUUID(), "e".repeat(64), staffUserId]);
    const otherJobId = randomUUID();
    await pool!.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,assigned_staff_id,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'ASSIGNED',$8,'2099-01-08T06:30:00Z','2099-01-08T07:00:00Z',$9,$10)", [otherJobId, organizationId, centreId, `J-${otherJobId.slice(0, 8)}`, otherBooking.appointment.id, otherOrderId, patientId, otherStaffId, randomUUID(), staffUserId]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [
      { key: "collections.read", centreId }, { key: "collections.visit.record", centreId },
    ] }, response: null });
    const references = await taskReferencesHandler(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=COLLECTION_JOB`));
    expect(references.status).toBe(200);
    const referenceBody = await references.json() as { references: Array<{ id: string }> };
    expect(referenceBody.references.map((reference) => reference.id)).toContain(jobId);
    expect(referenceBody.references.map((reference) => reference.id)).not.toContain(otherJobId);
  });

  it("denies the walk-in queue without appointment permission and rejects cross-origin mutations", async () => {
    mocks.getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const deniedRead = await queueHandler(new Request(`http://localhost/api/appointments/queue?centreId=${centreId}`));
    expect(deniedRead.status).toBe(403);
    expect(await deniedRead.json()).toEqual({ error: "forbidden" });
    const crossOriginMutation = await queueActionHandler(new Request("http://localhost/api/appointments/queue", { method: "POST", headers: { origin: "https://invalid.example", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "CALL_NEXT", centreId }) }));
    expect(crossOriginMutation.status).toBe(403);
  });

  it("counts and groups assigned appointments and collection jobs by centre-local roster day", async () => {
    const key = randomUUID();
    const createdResponse = await handler(request(key));
    const body = await createdResponse.json() as { appointment?: { id: string } };
    expect(createdResponse.status).toBe(201);
    const windowStart = "2099-01-05T18:30:00.000Z"; // midnight at the synthetic centre's Asia/Kolkata timezone
    await pool.query("UPDATE appointments SET scheduled_at=$2, assigned_staff_id=$3 WHERE id=$1", [body.appointment!.id, "2099-01-05T18:15:00.000Z", staffUserId]);
    const orderId = randomUUID(); const jobId = randomUUID();
    await pool.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [orderId, organizationId, centreId, `O-${orderId.slice(0, 8)}`, patientId, body.appointment!.id, randomUUID(), "c".repeat(64), staffUserId]);
    await pool.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,assigned_staff_id,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'ASSIGNED',$8,$9,$10,$11,$8)", [jobId, organizationId, centreId, `J-${jobId.slice(0, 8)}`, body.appointment!.id, orderId, patientId, staffUserId, "2099-01-05T18:20:00.000Z", "2099-01-05T18:50:00.000Z", randomUUID()]);
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    const scheduledShiftId = randomUUID();
    const unavailableShiftId = randomUUID();
    const shiftRows = [
      { id: scheduledShiftId, type: "SCHEDULED", starts: windowStart, ends: "2099-01-05T19:00:00.000Z" },
      { id: unavailableShiftId, type: "UNAVAILABLE", starts: "2099-01-05T19:00:00.000Z", ends: "2099-01-05T19:30:00.000Z" },
    ];
    for (const shift of shiftRows) {
      const privateData = encryptOperationalData({ note: "Synthetic workload coverage test" }, operationalContext({ organizationId, centreId, recordId: shift.id }, "staff-shift"));
      await pool.query("INSERT INTO staff_shifts(id,organization_id,centre_id,staff_id,shift_type,starts_at,ends_at,time_zone,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,'Asia/Kolkata',$8,$4,$9,$10)", [shift.id, organizationId, centreId, staffUserId, shift.type, shift.starts, shift.ends, privateData, randomUUID(), "a".repeat(64)]);
    }
    const response = await workloadHandler(new Request(`http://localhost/api/roster/workload?centreId=${centreId}&from=${windowStart}&to=2099-01-05T19:30:00.000Z`));
    expect(response.status).toBe(200);
    const result = await response.json() as { staff: Array<{ id: string; appointments: number; collections: number; appointmentsOutsideRoster: number; scheduledMinutes: number; unavailablePeriods: number }>; dailyWorkload: Array<{ staffId: string; day: string; appointments: number; collections: number }> };
    expect(result.staff.find((item) => item.id === staffUserId)).toMatchObject({ appointments: 1, appointmentsOutsideRoster: 1, scheduledMinutes: 30, unavailablePeriods: 1 });
    expect(result.staff.find((item) => item.id === staffUserId)?.collections).toBe(1);
    expect(result.dailyWorkload).toContainEqual({ staffId: staffUserId, day: "2099-01-06", appointments: 1, collections: 1 });
  });

  it("limits basic roster readers to their own shifts and workload", async () => {
    const otherStaffId = randomUUID(); const otherAuthId = randomUUID();
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [otherAuthId, "Synthetic Other Staff", `${otherAuthId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [otherStaffId, otherAuthId, organizationId, `ST-${otherStaffId.slice(0, 8)}`, "Synthetic Other Staff"]);
    const role = await pool.query("SELECT id FROM roles WHERE organization_id=$1 AND key='synthetic_workload' LIMIT 1", [organizationId]);
    await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, otherStaffId, role.rows[0].id, centreId]);
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    for (const [id, staffId, note] of [[randomUUID(), staffUserId, "Synthetic own shift"], [randomUUID(), otherStaffId, "PRIVATE OTHER STAFF ROSTER NOTE"]]) {
      const ciphertext = encryptOperationalData({ note }, operationalContext({ organizationId, centreId, recordId: id }, "staff-shift"));
      await pool.query("INSERT INTO staff_shifts(id,organization_id,centre_id,staff_id,shift_type,starts_at,ends_at,time_zone,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'SCHEDULED','2099-03-02T03:30:00.000Z','2099-03-02T11:30:00.000Z','Asia/Kolkata',$5,$6,$7,$8)", [id, organizationId, centreId, staffId, ciphertext, staffUserId, randomUUID(), "b".repeat(64)]);
    }
    const reader = { organizationId, staffUserId, grants: [{ key: "roster.read", centreId }] };
    mocks.getApiAccess.mockResolvedValue({ staff: reader, response: null });

    const rosterResponse = await rosterListHandler(new Request(`http://localhost/api/roster?centreId=${centreId}&from=2099-03-02T00%3A00%3A00.000Z&to=2099-03-03T00%3A00%3A00.000Z`));
    expect(rosterResponse.status).toBe(200);
    const rosterBody = await rosterResponse.text();
    expect(rosterBody).toContain("Synthetic own shift");
    expect(rosterBody).not.toContain("PRIVATE OTHER STAFF ROSTER NOTE");
    const otherShiftRead = await rosterListHandler(new Request(`http://localhost/api/roster?centreId=${centreId}&staffId=${otherStaffId}`));
    expect(otherShiftRead.status).toBe(404);
    expect(await otherShiftRead.json()).toEqual({ error: "not_found" });
    const shiftIds = await pool.query("SELECT id,staff_id FROM staff_shifts WHERE organization_id=$1 AND centre_id=$2 AND starts_at='2099-03-02T03:30:00.000Z' ORDER BY staff_id", [organizationId, centreId]);
    const ownShiftId = shiftIds.rows.find((row) => row.staff_id === staffUserId)?.id as string;
    const otherShiftId = shiftIds.rows.find((row) => row.staff_id === otherStaffId)?.id as string;
    const detailRoute = (id: string) => rosterDetailHandler(new Request(`http://localhost/api/roster/${id}`), { params: Promise.resolve({ id }) });
    const ownShiftDetail = await detailRoute(ownShiftId);
    expect(ownShiftDetail.status).toBe(200);
    expect(await ownShiftDetail.json()).toMatchObject({ shift: { id: ownShiftId, note: "Synthetic own shift" } });
    const otherShiftDetail = await detailRoute(otherShiftId);
    expect(otherShiftDetail.status).toBe(404);
    expect(await otherShiftDetail.json()).toEqual({ error: "not_found" });

    const workloadResponse = await workloadHandler(new Request(`http://localhost/api/roster/workload?centreId=${centreId}&from=2099-03-02T00:00:00.000Z&to=2099-03-03T00:00:00.000Z`));
    expect(workloadResponse.status).toBe(200);
    const workloadBody = await workloadResponse.json() as { staff: Array<{ id: string }>; dailyWorkload: Array<{ staffId: string }> };
    expect(workloadBody.staff.map(({ id }) => id)).toEqual([staffUserId]);
    expect(workloadBody.dailyWorkload.every(({ staffId }) => staffId === staffUserId)).toBe(true);
    await pool.query("UPDATE staff_shifts SET shift_type='UNAVAILABLE' WHERE organization_id=$1 AND staff_id=$2 AND starts_at='2099-03-02T03:30:00.000Z'", [organizationId, staffUserId]);

    const ownAppointmentResponse = await handler(request(randomUUID(), "2099-03-02T10:00"));
    const otherAppointmentResponse = await handler(request(randomUUID(), "2099-03-02T11:00"));
    const ownAppointment = (await ownAppointmentResponse.json() as { appointment: { id: string } }).appointment;
    const otherAppointment = (await otherAppointmentResponse.json() as { appointment: { id: string } }).appointment;
    await pool.query("UPDATE appointments SET assigned_staff_id=$2, status='ASSIGNED' WHERE id=$1", [ownAppointment.id, staffUserId]);
    await pool.query("UPDATE appointments SET assigned_staff_id=$2, status='ASSIGNED' WHERE id=$1", [otherAppointment.id, otherStaffId]);
    for (const [appointmentId, assignedId] of [[ownAppointment.id, staffUserId], [otherAppointment.id, otherStaffId]]) {
      const orderId = randomUUID(); const jobId = randomUUID();
      await pool.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [orderId, organizationId, centreId, `O-${orderId.slice(0, 8)}`, patientId, appointmentId, randomUUID(), "d".repeat(64), staffUserId]);
      await pool.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,assigned_staff_id,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'ASSIGNED',$8,$9,$10,$11,$12)", [jobId, organizationId, centreId, `J-${jobId.slice(0, 8)}`, appointmentId, orderId, patientId, assignedId, "2099-03-02T04:00:00.000Z", "2099-03-02T04:30:00.000Z", randomUUID(), staffUserId]);
    }
    mocks.getApiAccess.mockImplementation(async (permission: string) => {
      if (permission === "appointments.read") return { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) };
      if (permission === "appointments.assigned.read" || permission === "roster.read" || permission === "collections.read") return { staff: reader, response: null };
      return { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) };
    });
    const conflictsResponse = await rosterConflictsHandler(new Request(`http://localhost/api/roster/conflicts?centreId=${centreId}&from=2099-03-02T00:00:00.000Z&to=2099-03-03T00:00:00.000Z`));
    expect(conflictsResponse.status).toBe(200);
    const conflictBody = await conflictsResponse.json() as { conflicts: Array<{ staffId: string }> };
    expect(conflictBody.conflicts.length).toBeGreaterThan(0);
    expect(conflictBody.conflicts.every(({ staffId }) => staffId === staffUserId)).toBe(true);

    const otherCentreId = randomUUID(); const otherCentreStaffId = randomUUID(); const otherCentreAuthId = randomUUID();
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [otherCentreId, organizationId, `C-${otherCentreId.slice(0, 8)}`, "Synthetic Other Centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [otherCentreAuthId, "Synthetic Other Centre User", `${otherCentreAuthId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [otherCentreStaffId, otherCentreAuthId, organizationId, `ST-${otherCentreStaffId.slice(0, 8)}`, "Synthetic Other Centre Staff"]);
    await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, otherCentreStaffId, role.rows[0].id, otherCentreId]);
    const otherCentreShiftId = randomUUID();
    const otherCentreCipher = encryptOperationalData({ note: "PRIVATE OTHER CENTRE ROSTER NOTE" }, operationalContext({ organizationId, centreId: otherCentreId, recordId: otherCentreShiftId }, "staff-shift"));
    await pool.query("INSERT INTO staff_shifts(id,organization_id,centre_id,staff_id,shift_type,starts_at,ends_at,time_zone,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'SCHEDULED','2099-03-02T03:30:00.000Z','2099-03-02T11:30:00.000Z','Asia/Kolkata',$5,$6,$7,$8)", [otherCentreShiftId, organizationId, otherCentreId, otherCentreStaffId, otherCentreCipher, staffUserId, randomUUID(), "e".repeat(64)]);
    const scopedManager = { organizationId, staffUserId, grants: [{ key: "roster.read", centreId }, { key: "roster.read", centreId: otherCentreId }, { key: "roster.manage", centreId }] };
    mocks.getApiAccess.mockResolvedValue({ staff: scopedManager, response: null });
    const unfilteredRosterResponse = await rosterListHandler(new Request("http://localhost/api/roster"));
    expect(unfilteredRosterResponse.status).toBe(200);
    const unfilteredRosterBody = await unfilteredRosterResponse.text();
    expect(unfilteredRosterBody).toContain("PRIVATE OTHER STAFF ROSTER NOTE");
    expect(unfilteredRosterBody).not.toContain("PRIVATE OTHER CENTRE ROSTER NOTE");
    const otherCentreStaffRead = await rosterListHandler(new Request(`http://localhost/api/roster?staffId=${otherCentreStaffId}`));
    expect(otherCentreStaffRead.status).toBe(200);
    expect(await otherCentreStaffRead.json()).toMatchObject({ shifts: [], hasMore: false });
  });

  it("rejects a persisted roster shift labelled with a timezone different from its centre", async () => {
    const before = await pool.query("SELECT count(*)::int AS count FROM staff_shifts WHERE organization_id=$1", [organizationId]);
    const response = await rosterCreateHandler(new Request("http://localhost/api/roster", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ centreId, staffId: staffUserId, shiftType: "SCHEDULED", startsAt: "2099-01-05T03:30:00.000Z", endsAt: "2099-01-05T11:30:00.000Z", timeZone: "America/Los_Angeles", note: "Synthetic timezone mismatch" }),
    }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "centre_timezone_mismatch" });
    const after = await pool.query("SELECT count(*)::int AS count FROM staff_shifts WHERE organization_id=$1", [organizationId]);
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("replays roster updates safely after an uncertain response and rejects key reuse with changed input", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "roster.manage", centreId }, { key: "workspace.read", centreId }] }, response: null });
    const createKey = randomUUID();
    const createResponse = await rosterCreateHandler(new Request("http://localhost/api/roster", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": createKey },
      body: JSON.stringify({ centreId, staffId: staffUserId, shiftType: "SCHEDULED", startsAt: "2099-02-02T03:30:00.000Z", endsAt: "2099-02-02T11:30:00.000Z", timeZone: "Asia/Kolkata", note: "Synthetic idempotency shift" }),
    }));
    expect(createResponse.status).toBe(201);
    const created = await createResponse.json() as { shift: { id: string } };
    const idempotencyKey = randomUUID();
    const updatePayload = { expectedVersion: 1, action: "UPDATE", startsAt: "2099-02-02T04:30:00.000Z", endsAt: "2099-02-02T12:30:00.000Z", note: "Synthetic retry-safe update" };
    const updateRequest = (payload = updatePayload) => new Request(`http://localhost/api/roster/${created.shift.id}`, {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify(payload),
    });
    const updateRoute = { params: Promise.resolve({ id: created.shift.id }) };
    const first = await rosterActionHandler(updateRequest(), updateRoute);
    expect(first.status, JSON.stringify(await first.clone().json())).toBe(200);
    expect(await first.json()).toMatchObject({ shift: { id: created.shift.id, versionNumber: 2, replayed: false } });
    const replay = await rosterActionHandler(updateRequest(), updateRoute);
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ shift: { id: created.shift.id, versionNumber: 2, replayed: true } });
    const changed = await rosterActionHandler(updateRequest({ ...updatePayload, note: "Different synthetic update" }), updateRoute);
    expect(changed.status).toBe(409);
    expect(await changed.json()).toEqual({ error: "idempotency_conflict" });
    const persisted = await pool.query("SELECT version_number, starts_at, ends_at FROM staff_shifts WHERE id=$1", [created.shift.id]);
    const events = await pool.query("SELECT count(*)::int AS count, count(DISTINCT idempotency_key)::int AS unique_count FROM staff_shift_events WHERE shift_id=$1 AND idempotency_key=$2", [created.shift.id, idempotencyKey]);
    expect(persisted.rows[0]).toMatchObject({ version_number: 2, starts_at: new Date(updatePayload.startsAt), ends_at: new Date(updatePayload.endsAt) });
    expect(events.rows[0]).toEqual({ count: 1, unique_count: 1 });
  });

  it("creates and edits a centre task-approval policy with eligible approvers, version checks, and audit snapshots", async () => {
    const policyCentreId = randomUUID();
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [policyCentreId, organizationId, `PC-${policyCentreId.slice(0, 8)}`, "Synthetic Policy Centre"]);
    const approvePermission = await pool.query("SELECT id FROM permissions WHERE key='tasks.approve' LIMIT 1");
    expect(approvePermission.rows).toHaveLength(1);
    const taskReadPermission = await pool.query("SELECT id FROM permissions WHERE key='tasks.read' LIMIT 1");
    expect(taskReadPermission.rows).toHaveLength(1);
    const approverRoleId = randomUUID();
    await pool.query("INSERT INTO roles(id,organization_id,key,name,scope) VALUES($1,$2,$3,$4,'CENTRE')", [approverRoleId, organizationId, `synthetic_policy_approver_${approverRoleId.slice(0, 8)}`, "Synthetic policy approver"]);
    await pool.query("INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2)", [approverRoleId, approvePermission.rows[0].id]);
    await pool.query("INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2)", [approverRoleId, taskReadPermission.rows[0].id]);
    await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, staffUserId, approverRoleId, policyCentreId]);
    const approveOnlyStaffId = randomUUID();
    const approveOnlyAuthUserId = randomUUID();
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [approveOnlyAuthUserId, "Synthetic Approve-Only Staff", `${approveOnlyStaffId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [approveOnlyStaffId, approveOnlyAuthUserId, organizationId, `APO-${approveOnlyStaffId.slice(0, 8)}`, "Synthetic Approve-Only Staff"]);
    const approveOnlyRoleId = randomUUID();
    await pool.query("INSERT INTO roles(id,organization_id,key,name,scope) VALUES($1,$2,$3,$4,'CENTRE')", [approveOnlyRoleId, organizationId, `synthetic_approve_only_${approveOnlyRoleId.slice(0, 8)}`, "Synthetic approve-only"]);
    await pool.query("INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2)", [approveOnlyRoleId, approvePermission.rows[0].id]);
    await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, approveOnlyStaffId, approveOnlyRoleId, policyCentreId]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "tasks.approve", centreId: policyCentreId }] }, response: null });
    const pickerResponse = await taskApproverPickerHandler(new Request(`http://localhost/api/tasks/approvers?centreId=${policyCentreId}`));
    expect(pickerResponse.status).toBe(200);
    expect(await pickerResponse.json()).toEqual({ approvers: [expect.objectContaining({ id: staffUserId })] });
    const policyManager = { organizationId, staffUserId, grants: [{ key: "tasks.policy.manage", centreId: policyCentreId }] };
    mocks.getApiAccess.mockResolvedValue({ staff: policyManager, response: null });
    const policyIdempotencyKey = randomUUID();
    const send = (body: unknown, key = randomUUID()) => new Request("http://localhost/api/tasks/policy", { method: "PUT", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });
    const firstPayload = { centreId: policyCentreId, actionType: "TASK_COMPLETION", enabled: true, approverStaffIds: [staffUserId], escalationAfterMinutes: null, escalationOwnerStaffId: null, expireAfterMinutes: 120, expectedVersion: 0 };
    const first = await approvalPolicyHandler(send(firstPayload, policyIdempotencyKey));
    expect(first.status, JSON.stringify(await first.clone().json())).toBe(200);
    const created = await first.json() as { policy: { id: string; versionNumber: number; approverStaffIds: string[]; expireAfterMinutes: number | null } };
    expect(created.policy).toMatchObject({ centreId: policyCentreId, actionType: "TASK_COMPLETION", enabled: true, versionNumber: 1, approverStaffIds: [staffUserId], expireAfterMinutes: 120 });
    const approveOnlyAttempt = await approvalPolicyHandler(send({ ...firstPayload, approverStaffIds: [approveOnlyStaffId] }));
    expect(approveOnlyAttempt.status).toBe(400);
    expect(await approveOnlyAttempt.json()).toEqual({ error: "approver_not_eligible" });
    const second = await approvalPolicyHandler(send({ centreId: policyCentreId, actionType: "TASK_COMPLETION", enabled: true, approverStaffIds: [staffUserId], escalationAfterMinutes: 60, escalationOwnerStaffId: staffUserId, expireAfterMinutes: 120, expectedVersion: 1 }));
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ policy: { id: created.policy.id, versionNumber: 2, escalationAfterMinutes: 60, escalationOwnerStaffId: staffUserId } });
    const stale = await approvalPolicyHandler(send({ centreId: policyCentreId, actionType: "TASK_COMPLETION", enabled: false, approverStaffIds: [], escalationAfterMinutes: null, escalationOwnerStaffId: null, expireAfterMinutes: null, expectedVersion: 1 }));
    expect(stale.status).toBe(409);
    expect(await stale.json()).toEqual({ error: "version_conflict" });
    const replay = await approvalPolicyHandler(send(firstPayload, policyIdempotencyKey));
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ policy: { id: created.policy.id, versionNumber: 1, replayed: true } });
    const reusedKey = await approvalPolicyHandler(send({ ...firstPayload, enabled: false }, policyIdempotencyKey));
    expect(reusedKey.status).toBe(409);
    expect(await reusedKey.json()).toEqual({ error: "idempotency_conflict" });
    const persisted = await pool.query("SELECT enabled,version_number,escalation_after_minutes,escalation_owner_staff_id,expire_after_minutes FROM staff_approval_policies WHERE id=$1", [created.policy.id]);
    expect(persisted.rows[0]).toMatchObject({ enabled: true, version_number: 2, escalation_after_minutes: 60, escalation_owner_staff_id: staffUserId, expire_after_minutes: 120 });
    const historyResponse = await approvalPolicyReadHandler(new Request(`http://localhost/api/tasks/policy?view=history&centreId=${policyCentreId}`));
    expect(historyResponse.status).toBe(200);
    const policyHistory = await historyResponse.json();
    expect(JSON.stringify(policyHistory)).not.toContain(staffUserId);
    expect(policyHistory).toMatchObject({ history: [
      { action: "staff_approval_policy.updated", version: 2, enabled: true, approverDisplayNames: ["Synthetic Owner (ST-" + staffUserId.slice(0, 8) + ")"], escalationAfterMinutes: 60, escalationOwnerDisplayName: "Synthetic Owner (ST-" + staffUserId.slice(0, 8) + ")", expireAfterMinutes: 120, actorDisplayName: "Synthetic Owner (ST-" + staffUserId.slice(0, 8) + ")", snapshotComplete: true },
      { action: "staff_approval_policy.updated", version: 1, enabled: true, approverDisplayNames: ["Synthetic Owner (ST-" + staffUserId.slice(0, 8) + ")"], escalationAfterMinutes: null, escalationOwnerDisplayName: null, expireAfterMinutes: 120, actorDisplayName: "Synthetic Owner (ST-" + staffUserId.slice(0, 8) + ")", snapshotComplete: true },
    ], hasMore: false });
    const approversRead = await approvalPolicyReadHandler(new Request(`http://localhost/api/tasks/policy?centreId=${policyCentreId}`));
    const approverPayload = await approversRead.json();
    expect(approverPayload).toMatchObject({ policy: { id: created.policy.id, versionNumber: 2, approverStaffIds: [staffUserId] }, eligibleApprovers: expect.arrayContaining([expect.objectContaining({ id: staffUserId })]) });
    expect(approverPayload.eligibleApprovers).not.toEqual(expect.arrayContaining([expect.objectContaining({ id: approveOnlyStaffId })]));
    const concurrent = await Promise.all([
      approvalPolicyHandler(send({ centreId: policyCentreId, actionType: "TASK_COMPLETION", enabled: false, approverStaffIds: [], escalationAfterMinutes: null, escalationOwnerStaffId: null, expireAfterMinutes: null, expectedVersion: 2 })),
      approvalPolicyHandler(send({ centreId: policyCentreId, actionType: "TASK_COMPLETION", enabled: true, approverStaffIds: [staffUserId], escalationAfterMinutes: null, escalationOwnerStaffId: null, expireAfterMinutes: 90, expectedVersion: 2 })),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([200, 409]);
    const afterRace = await pool.query("SELECT version_number FROM staff_approval_policies WHERE id=$1", [created.policy.id]);
    const historyAfterRace = await pool.query("SELECT count(*)::int AS count FROM audit_events WHERE organization_id=$1 AND entity_type='staff_approval_policy' AND entity_id=$2 AND action='staff_approval_policy.updated'", [organizationId, created.policy.id]);
    expect(afterRace.rows[0].version_number).toBe(3);
    expect(historyAfterRace.rows[0].count).toBe(3);
    const persistedKeys = await pool.query("SELECT details->>'idempotencyKey' AS key, details->>'requestHash' AS request_hash FROM audit_events WHERE organization_id=$1 AND entity_id=$2 AND action='staff_approval_policy.updated'", [organizationId, created.policy.id]);
    expect(persistedKeys.rows.filter((row) => row.key === policyIdempotencyKey)).toHaveLength(1);
    expect(persistedKeys.rows.find((row) => row.key === policyIdempotencyKey)?.request_hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("rejects appointment reassignment that overlaps an active collection job", async () => {
    const created = await handler(request(randomUUID()));
    expect(created.status).toBe(201);
    const booking = await created.json() as { appointment: { id: string } };
    const orderId = randomUUID();
    await pool.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [orderId, organizationId, centreId, `O-${orderId.slice(0, 8)}`, patientId, booking.appointment.id, randomUUID(), "b".repeat(64), staffUserId]);
    const jobId = randomUUID();
    await pool.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,assigned_staff_id,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'ASSIGNED',$8,$9,$10,$11,$8)", [jobId, organizationId, centreId, `J-${jobId.slice(0, 8)}`, booking.appointment.id, orderId, patientId, staffUserId, "2099-01-05T04:15:00.000Z", "2099-01-05T04:45:00.000Z", randomUUID()]);
    const [current] = (await pool.query("SELECT updated_at FROM appointments WHERE id=$1", [booking.appointment.id])).rows;
    const response = await updateHandler(new Request(`http://localhost/api/appointments/${booking.appointment.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ expectedUpdatedAt: new Date(current.updated_at).toISOString(), assignedStaffId: staffUserId, reason: "Synthetic overlap resolution regression" }) }), { params: Promise.resolve({ id: booking.appointment.id }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "staff_time_conflict" });
    const persisted = await pool.query("SELECT assigned_staff_id FROM appointments WHERE id=$1", [booking.appointment.id]);
    expect(persisted.rows[0].assigned_staff_id).toBeNull();
    const beforeCreate = await pool.query("SELECT count(*)::int AS count FROM appointments WHERE organization_id=$1", [organizationId]);
    const createAssigned = new Request("http://localhost/api/appointments", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ centreId, patientId, source: "STAFF", visitType: "CENTRE", scheduledLocal: "2099-01-05T10:00", durationMinutes: 30, assignedStaffId: staffUserId, services: [{ type: "OTHER", name: "Synthetic overlap test" }] }) });
    const createConflict = await handler(createAssigned);
    expect(createConflict.status).toBe(409);
    expect(await createConflict.json()).toEqual({ error: "staff_time_conflict" });
    const afterCreate = await pool.query("SELECT count(*)::int AS count FROM appointments WHERE organization_id=$1", [organizationId]);
    expect(afterCreate.rows[0].count).toBe(beforeCreate.rows[0].count);
  });

  it("replays appointment reassignment without duplicate history and rejects assignment-key reuse", async () => {
    // This file uses one disposable schema for all cases. Give the assigned
    // booking a distinct slot so prior tests' fixtures cannot create a false
    // scheduling conflict when the whole integration file runs.
    const slot = Number.parseInt(randomUUID().replaceAll("-", "").slice(0, 8), 16) % (28 * 48);
    const day = Math.floor(slot / 48) + 1;
    const halfHour = slot % 48;
    const scheduledLocal = `2099-12-${String(day).padStart(2, "0")}T${String(Math.floor(halfHour / 2)).padStart(2, "0")}:${halfHour % 2 ? "30" : "00"}`;
    const created = await handler(request(randomUUID(), scheduledLocal));
    expect(created.status).toBe(201);
    const booking = await created.json() as { appointment: { id: string } };
    const grants = ["appointments.update", "appointments.assign", "workspace.read"];
    mocks.getApiAccess.mockImplementation(async (permission: string) => grants.includes(permission)
      ? { staff: { organizationId, staffUserId, grants: grants.map((key) => ({ key, centreId })) }, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const [current] = (await pool.query("SELECT updated_at FROM appointments WHERE id=$1", [booking.appointment.id])).rows;
    const key = randomUUID();
    const payload = { expectedUpdatedAt: new Date(current.updated_at).toISOString(), assignedStaffId: staffUserId, reason: "Synthetic retry-safe assignment" };
    const send = (body: unknown) => new Request(`http://localhost/api/appointments/${booking.appointment.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });
    const first = await updateHandler(send(payload), { params: Promise.resolve({ id: booking.appointment.id }) });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ replayed: false, appointment: { assignedStaffId: staffUserId } });
    const replay = await updateHandler(send(payload), { params: Promise.resolve({ id: booking.appointment.id }) });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true, appointment: { assignedStaffId: staffUserId } });
    const reused = await updateHandler(send({ ...payload, reason: "Changed retry payload" }), { params: Promise.resolve({ id: booking.appointment.id }) });
    expect(reused.status).toBe(409);
    expect(await reused.json()).toEqual({ error: "idempotency_conflict" });
    const persisted = await pool.query("SELECT count(*)::int AS count FROM appointment_assignment_history WHERE appointment_id=$1", [booking.appointment.id]);
    expect(persisted.rows[0].count).toBe(1);
  });

  it("serializes a concurrent appointment booking and collection assignment for the same staff window", async () => {
    const parent = await handler(new Request("http://localhost/api/appointments", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ centreId, patientId, source: "STAFF", visitType: "CENTRE", scheduledLocal: "2099-01-06T09:00", durationMinutes: 30, services: [{ type: "OTHER", name: "Synthetic collection parent" }] }) }));
    expect(parent.status).toBe(201);
    const parentBooking = await parent.json() as { appointment: { id: string } };
    const orderId = randomUUID();
    await pool.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [orderId, organizationId, centreId, `O-${orderId.slice(0, 8)}`, patientId, parentBooking.appointment.id, randomUUID(), "e".repeat(64), staffUserId]);
    const jobId = randomUUID();
    await pool.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING_ASSIGNMENT',$8,$9,$10,$11)", [jobId, organizationId, centreId, `J-${jobId.slice(0, 8)}`, parentBooking.appointment.id, orderId, patientId, "2099-01-06T04:15:00.000Z", "2099-01-06T04:45:00.000Z", randomUUID(), staffUserId]);
    const workloadRole = await pool.query("SELECT id FROM roles WHERE organization_id=$1 AND key='synthetic_workload'", [organizationId]);
    const collectorPermissionId = randomUUID();
    await pool.query("INSERT INTO permissions(id,key,description,scope) VALUES($1,'collections.visit.record','Synthetic collection visit permission','CENTRE') ON CONFLICT(key) DO NOTHING", [collectorPermissionId]);
    const collectorPermission = await pool.query("SELECT id FROM permissions WHERE key='collections.visit.record'");
    await pool.query("INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [workloadRole.rows[0].id, collectorPermission.rows[0].id]);
    const grants = ["appointments.create", "patients.read", "appointments.assign", "collections.assign"];
    mocks.getApiAccess.mockImplementation(async (permission: string, _requestedCentre?: string) => grants.includes(permission)
      ? { staff: { organizationId, staffUserId, grants: grants.map((key) => ({ key, centreId })) }, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const bookingRequest = new Request("http://localhost/api/appointments", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ centreId, patientId, source: "STAFF", visitType: "CENTRE", scheduledLocal: "2099-01-06T10:00", durationMinutes: 30, assignedStaffId: staffUserId, services: [{ type: "OTHER", name: "Synthetic concurrent workload test" }] }) });
    const assignmentRequest = new Request(`http://localhost/api/collections/${jobId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ expectedVersion: 1, action: "assign", staffUserId, reason: "Synthetic concurrent scheduling race test" }) });
    const [bookingResponse, assignmentResponse] = await Promise.all([
      handler(bookingRequest),
      collectionActionHandler(assignmentRequest, { params: Promise.resolve({ id: jobId }) }),
    ]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }, { key: "appointments.update", centreId }, { key: "appointments.assign", centreId }, { key: "roster.read", centreId }, { key: "finance.read", centreId }] }, response: null });
    const statuses = [bookingResponse.status, assignmentResponse.status];
    expect(statuses.filter((status) => status === 201 || status === 200), JSON.stringify([await bookingResponse.clone().json(), await assignmentResponse.clone().json()])).toHaveLength(1);
    expect(statuses.filter((status) => status === 409), JSON.stringify([await bookingResponse.clone().json(), await assignmentResponse.clone().json()])).toHaveLength(1);
    const persisted = await pool.query("SELECT (SELECT count(*)::int FROM appointments a WHERE a.organization_id=$1 AND a.assigned_staff_id=$2 AND a.scheduled_at < $4::timestamptz AND a.scheduled_at + (a.duration_minutes * interval '1 minute') > $3::timestamptz AND a.id <> $5) AS appointment_count, (SELECT count(*)::int FROM collection_jobs j WHERE j.organization_id=$1 AND j.assigned_staff_id=$2 AND j.status IN ('PENDING_ASSIGNMENT','ASSIGNED','IN_PROGRESS') AND j.scheduled_start < $4::timestamptz AND j.scheduled_end > $3::timestamptz) AS collection_count", [organizationId, staffUserId, "2099-01-06T04:15:00.000Z", "2099-01-06T04:45:00.000Z", parentBooking.appointment.id]);
    expect(Number(persisted.rows[0].appointment_count) + Number(persisted.rows[0].collection_count)).toBe(1);
  });

  it("replays collection reassignment without duplicating the custody event", async () => {
    const parent = await handler(new Request("http://localhost/api/appointments", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ centreId, patientId, source: "STAFF", visitType: "CENTRE", scheduledLocal: "2099-02-10T09:00", durationMinutes: 30, services: [{ type: "OTHER", name: "Synthetic collection assignment replay" }] }) }));
    expect(parent.status).toBe(201);
    const booking = await parent.json() as { appointment: { id: string } };
    const orderId = randomUUID(); const jobId = randomUUID();
    await pool.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [orderId, organizationId, centreId, `O-${orderId.slice(0, 8)}`, patientId, booking.appointment.id, randomUUID(), "d".repeat(64), staffUserId]);
    await pool.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING_ASSIGNMENT',$8,$9,$10,$11)", [jobId, organizationId, centreId, `J-${jobId.slice(0, 8)}`, booking.appointment.id, orderId, patientId, "2099-02-10T03:30:00.000Z", "2099-02-10T04:00:00.000Z", randomUUID(), staffUserId]);
    const role = await pool.query("SELECT id FROM roles WHERE organization_id=$1 AND key='synthetic_workload'", [organizationId]);
    const permissionId = randomUUID();
    await pool.query("INSERT INTO permissions(id,key,description,scope) VALUES($1,'collections.visit.record','Synthetic collection visit permission','CENTRE') ON CONFLICT(key) DO NOTHING", [permissionId]);
    const permission = await pool.query("SELECT id FROM permissions WHERE key='collections.visit.record'");
    await pool.query("INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [role.rows[0].id, permission.rows[0].id]);
    const grants = ["collections.assign", "collections.visit.record", "appointments.create", "patients.read", "samples.collect"];
    mocks.getApiAccess.mockImplementation(async (permissionKey: string) => grants.includes(permissionKey)
      ? { staff: { organizationId, staffUserId, grants: grants.map((key) => ({ key, centreId })) }, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const missingMutationKey = await collectionActionHandler(new Request(`http://localhost/api/collections/${jobId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ expectedVersion: 1, action: "start", reason: "Synthetic missing idempotency key" }) }), { params: Promise.resolve({ id: jobId }) });
    expect(missingMutationKey.status).toBe(400);
    expect(await missingMutationKey.json()).toEqual({ error: "idempotency_key_required" });
    const idempotencyKey = randomUUID();
    const assignment = { expectedVersion: 1, action: "assign", staffUserId, reason: "Synthetic retry-safe collection assignment" };
    const send = (payload: typeof assignment) => new Request(`http://localhost/api/collections/${jobId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify(payload) });
    const first = await collectionActionHandler(send(assignment), { params: Promise.resolve({ id: jobId }) });
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ replayed: false, job: { status: "ASSIGNED", versionNumber: 2 } });
    const replay = await collectionActionHandler(send(assignment), { params: Promise.resolve({ id: jobId }) });
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ replayed: true, job: { status: "ASSIGNED", versionNumber: 2 } });
    const reused = await collectionActionHandler(send({ ...assignment, reason: "Different retry payload" }), { params: Promise.resolve({ id: jobId }) });
    expect(reused.status).toBe(409);
    expect(await reused.json()).toEqual({ error: "idempotency_conflict" });
    const persisted = await pool.query("SELECT count(*)::int AS count FROM collection_job_events WHERE job_id=$1 AND event_type IN ('ASSIGNED','REASSIGNED')", [jobId]);
    expect(persisted.rows[0].count).toBe(1);
    const auditFingerprint = await pool.query("SELECT details->>'mutationRequestHash' AS fingerprint FROM audit_events WHERE organization_id=$1 AND entity_type='collection_job' AND entity_id=$2 AND details->>'mutationIdempotencyKey' LIKE $3", [organizationId, jobId, `%${idempotencyKey}`]);
    expect(auditFingerprint.rowCount).toBe(1);
    expect(auditFingerprint.rows[0].fingerprint).not.toBe(createHash("sha256").update(JSON.stringify(assignment)).digest("hex"));
    const acceptanceKey = randomUUID();
    const acceptance = { expectedVersion: 2, action: "accept", reason: "Synthetic collector acknowledged assignment" };
    const sendAcceptance = (payload: typeof acceptance) => new Request(`http://localhost/api/collections/${jobId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": acceptanceKey }, body: JSON.stringify(payload) });
    const accepted = await collectionActionHandler(sendAcceptance(acceptance), { params: Promise.resolve({ id: jobId }) });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toMatchObject({ replayed: false, job: { status: "ASSIGNED", versionNumber: 3 } });
    expect(await (await collectionActionHandler(sendAcceptance(acceptance), { params: Promise.resolve({ id: jobId }) })).json()).toMatchObject({ replayed: true });
    expect(await (await collectionActionHandler(sendAcceptance({ ...acceptance, reason: "Changed acceptance reason" }), { params: Promise.resolve({ id: jobId }) })).json()).toEqual({ error: "idempotency_conflict" });
    const visitKey = randomUUID();
    const startAction = { expectedVersion: 3, action: "start", reason: "Synthetic assigned collector started visit" };
    const sendStart = (payload: typeof startAction) => new Request(`http://localhost/api/collections/${jobId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": visitKey }, body: JSON.stringify(payload) });
    const started = await collectionActionHandler(sendStart(startAction), { params: Promise.resolve({ id: jobId }) });
    expect(started.status).toBe(200);
    expect(await started.json()).toMatchObject({ replayed: false, job: { status: "IN_PROGRESS", versionNumber: 4 } });
    const startReplay = await collectionActionHandler(sendStart(startAction), { params: Promise.resolve({ id: jobId }) });
    expect(startReplay.status).toBe(200);
    expect(await startReplay.json()).toMatchObject({ replayed: true, job: { status: "IN_PROGRESS", versionNumber: 4 } });
    const conflictingStartReplay = await collectionActionHandler(sendStart({ ...startAction, reason: "Different visit action" }), { params: Promise.resolve({ id: jobId }) });
    expect(conflictingStartReplay.status).toBe(409);
    expect(await conflictingStartReplay.json()).toEqual({ error: "idempotency_conflict" });
    const startEvents = await pool.query("SELECT count(*)::int AS count FROM collection_job_events WHERE job_id=$1 AND event_type='TRAVEL_STARTED'", [jobId]);
    expect(startEvents.rows[0].count).toBe(1);
    const runIdempotentAction = async (version: number, action: "arrive" | "unsuccessful" | "cancel", reason: string, eventType: string, expectedStatus: string, expectedVersion: number) => {
      const key = randomUUID();
      const payload = { expectedVersion: version, action, reason };
      const sendAction = () => new Request(`http://localhost/api/collections/${jobId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(payload) });
      const firstAction = await collectionActionHandler(sendAction(), { params: Promise.resolve({ id: jobId }) });
      expect(firstAction.status).toBe(200);
      expect(await firstAction.json()).toMatchObject({ replayed: false, job: { status: expectedStatus, versionNumber: expectedVersion } });
      const replayAction = await collectionActionHandler(sendAction(), { params: Promise.resolve({ id: jobId }) });
      expect(replayAction.status).toBe(200);
      expect(await replayAction.json()).toMatchObject({ replayed: true, job: { status: expectedStatus, versionNumber: expectedVersion } });
      const eventCount = await pool.query("SELECT count(*)::int AS count FROM collection_job_events WHERE job_id=$1 AND event_type=$2", [jobId, eventType]);
      expect(eventCount.rows[0].count).toBe(1);
    };
    await runIdempotentAction(4, "arrive", "Synthetic assigned staff arrival recorded", "ARRIVED", "IN_PROGRESS", 5);
    const duplicateArrival = await collectionActionHandler(new Request(`http://localhost/api/collections/${jobId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ expectedVersion: 5, action: "arrive", reason: "Synthetic duplicate arrival attempt" }) }), { params: Promise.resolve({ id: jobId }) });
    expect(duplicateArrival.status).toBe(409);
    expect(await duplicateArrival.json()).toEqual({ error: "arrival_already_recorded" });
    const rejectedDelay = await collectionActionHandler(new Request(`http://localhost/api/collections/${jobId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ expectedVersion: 5, action: "delay", reason: "Synthetic delay after arrival" }) }), { params: Promise.resolve({ id: jobId }) });
    expect(rejectedDelay.status).toBe(409);
    expect(await rejectedDelay.json()).toEqual({ error: "arrival_already_recorded" });
    await runIdempotentAction(5, "unsuccessful", "Synthetic patient unavailable", "ATTEMPT_FAILED", "UNSUCCESSFUL", 6);
    await runIdempotentAction(6, "cancel", "Synthetic manager cancelled the unsuccessful job", "CANCELLED", "CANCELLED", 7);

    const completionAppointmentResponse = await handler(new Request("http://localhost/api/appointments", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ centreId, patientId, source: "STAFF", visitType: "CENTRE", scheduledLocal: "2099-02-11T09:00", durationMinutes: 30, services: [{ type: "OTHER", name: "Synthetic collection completion retry" }] }) }));
    expect(completionAppointmentResponse.status).toBe(201);
    const completionAppointment = await completionAppointmentResponse.json() as { appointment: { id: string } };
    const completionOrderId = randomUUID();
    const completionJobId = randomUUID();
    await pool.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [completionOrderId, organizationId, centreId, `O-${completionOrderId.slice(0, 8)}`, patientId, completionAppointment.appointment.id, randomUUID(), "f".repeat(64), staffUserId]);
    await pool.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'PENDING_ASSIGNMENT',$8,$9,$10,$11)", [completionJobId, organizationId, centreId, `J-${completionJobId.slice(0, 8)}`, completionAppointment.appointment.id, completionOrderId, patientId, "2099-02-11T03:30:00.000Z", "2099-02-11T04:00:00.000Z", randomUUID(), staffUserId]);
    const assignCompletion = (expectedVersion: number, action: "assign" | "accept" | "start", key: string, body: Record<string, unknown>) => collectionActionHandler(new Request(`http://localhost/api/collections/${completionJobId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify({ expectedVersion, action, ...body }) }), { params: Promise.resolve({ id: completionJobId }) });
    const completionAssignment = await assignCompletion(1, "assign", randomUUID(), { staffUserId, reason: "Synthetic collector assignment for completion retry" });
    expect(completionAssignment.status).toBe(200);
    const completionAcceptance = await assignCompletion(2, "accept", randomUUID(), { reason: "Synthetic collector accepts completion assignment" });
    expect(completionAcceptance.status).toBe(200);
    const completionStart = await assignCompletion(3, "start", randomUUID(), { reason: "Synthetic collection visit started" });
    expect(completionStart.status).toBe(200);
    const completionBeforeArrival = await collectionActionHandler(new Request(`http://localhost/api/collections/${completionJobId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ expectedVersion: 4, action: "complete", reason: "Synthetic completion before arrival" }) }), { params: Promise.resolve({ id: completionJobId }) });
    expect(completionBeforeArrival.status).toBe(409);
    expect(await completionBeforeArrival.json()).toEqual({ error: "arrival_required" });
    const completionArrival = await collectionActionHandler(new Request(`http://localhost/api/collections/${completionJobId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ expectedVersion: 4, action: "arrive", reason: "Synthetic arrival before specimen collection" }) }), { params: Promise.resolve({ id: completionJobId }) });
    expect(completionArrival.status).toBe(200);
    expect(await completionArrival.json()).toMatchObject({ job: { status: "IN_PROGRESS", versionNumber: 5 } });
    const procedureId = randomUUID();
    const specimenId = randomUUID();
    await pool.query("INSERT INTO sample_procedure_approvals(id,organization_id,centre_id,operation,reference,status,approved_by_staff_id) VALUES($1,$2,$3,'COLLECTION',$4,'ACTIVE',$5)", [procedureId, organizationId, centreId, `SYNTH-COLLECTION-${specimenId.slice(0, 8)}`, staffUserId]);
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    const specimenCiphertext = encryptOperationalData({ specimenType: "Synthetic specimen", requirementReference: "SYNTHETIC-REQUIREMENT" }, operationalContext({ organizationId, centreId, recordId: specimenId }, "specimen"));
    await pool.query("INSERT INTO specimens(id,organization_id,centre_id,job_id,order_id,patient_id,specimen_number,idempotency_key,private_data_ciphertext,status,identity_check_confirmed,collection_procedure_approval_id,collected_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'COLLECTED',true,$10,$11)", [specimenId, organizationId, centreId, completionJobId, completionOrderId, patientId, `SP-${specimenId.slice(0, 8)}`, randomUUID(), specimenCiphertext, procedureId, staffUserId]);
    const failedAfterCollection = await collectionActionHandler(new Request(`http://localhost/api/collections/${completionJobId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ expectedVersion: 5, action: "unsuccessful", reason: "Synthetic failure after specimen collection" }) }), { params: Promise.resolve({ id: completionJobId }) });
    expect(failedAfterCollection.status).toBe(409);
    expect(await failedAfterCollection.json()).toEqual({ error: "specimen_already_recorded" });
    const cancelledAfterCollection = await collectionActionHandler(new Request(`http://localhost/api/collections/${completionJobId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ expectedVersion: 5, action: "cancel", reason: "Synthetic cancellation after specimen collection" }) }), { params: Promise.resolve({ id: completionJobId }) });
    expect(cancelledAfterCollection.status).toBe(409);
    expect(await cancelledAfterCollection.json()).toEqual({ error: "specimen_already_recorded" });
    const completionKey = randomUUID();
    const completionBody = { expectedVersion: 5, action: "complete", reason: "Synthetic specimen collection recorded" };
    const completeRequest = () => new Request(`http://localhost/api/collections/${completionJobId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": completionKey }, body: JSON.stringify(completionBody) });
    const collectionCompleted = await collectionActionHandler(completeRequest(), { params: Promise.resolve({ id: completionJobId }) });
    expect(collectionCompleted.status).toBe(200);
    expect(await collectionCompleted.json()).toMatchObject({ replayed: false, job: { status: "COLLECTED", versionNumber: 6 } });
    const collectionCompletionReplay = await collectionActionHandler(completeRequest(), { params: Promise.resolve({ id: completionJobId }) });
    expect(collectionCompletionReplay.status).toBe(200);
    expect(await collectionCompletionReplay.json()).toMatchObject({ replayed: true, job: { status: "COLLECTED", versionNumber: 6 } });
    const completionEvents = await pool.query("SELECT count(*)::int AS count FROM collection_job_events WHERE job_id=$1 AND event_type='COLLECTION_RECORDED'", [completionJobId]);
    expect(completionEvents.rows[0].count).toBe(1);
  });

  it("persists task approval expiry and due escalation actions with immutable history", async () => {
    const actorId = randomUUID(); const actorAuthId = randomUUID(); const escalationOwnerId = randomUUID(); const ownerAuthId = randomUUID();
    for (const [staffId, authId, name] of [[actorId, actorAuthId, "Synthetic Task Approver"], [escalationOwnerId, ownerAuthId, "Synthetic Escalation Owner"]]) {
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authId, name, `${authId}@invalid.test`]);
      await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [staffId, authId, organizationId, `ST-${staffId.slice(0, 8)}`, name]);
    }
    const workloadRole = await pool.query("SELECT id FROM roles WHERE organization_id=$1 AND key='synthetic_workload'", [organizationId]);
    for (const [key, description] of [["tasks.approve", "Synthetic task approval permission"], ["tasks.read", "Synthetic task read permission"]]) {
      await pool.query("INSERT INTO permissions(id,key,description,scope) VALUES($1,$2,$3,'CENTRE') ON CONFLICT(key) DO NOTHING", [randomUUID(), key, description]);
    }
    await pool.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key='tasks.approve' ON CONFLICT DO NOTHING", [workloadRole.rows[0].id]);
    const taskReadRoleId = randomUUID();
    await pool.query("INSERT INTO roles(id,organization_id,key,name,scope,is_system) VALUES($1,$2,$3,$4,'CENTRE',false)", [taskReadRoleId, organizationId, `task_reader_${taskReadRoleId.slice(0, 8)}`, "Synthetic task reader role"]);
    await pool.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key='tasks.read' ON CONFLICT DO NOTHING", [taskReadRoleId]);
    for (const staffId of [actorId, escalationOwnerId]) {
      await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, staffId, workloadRole.rows[0].id, centreId]);
      await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, staffId, taskReadRoleId, centreId]);
    }

    const policyId = randomUUID();
    await pool.query("INSERT INTO staff_approval_policies(id,organization_id,centre_id,action_type,enabled,approver_permission,escalation_after_minutes,escalation_owner_staff_id,expire_after_minutes,version_number,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,$3,'TASK_COMPLETION',true,'tasks.approve',15,$4,30,1,$5,$5)", [policyId, organizationId, centreId, escalationOwnerId, staffUserId]);
    await pool.query("INSERT INTO staff_approval_policy_approvers(organization_id,policy_id,staff_id,created_by_staff_id) VALUES($1,$2,$3,$4)", [organizationId, policyId, actorId, staffUserId]);

    const makeTask = async (taskNumber: string, withEscalation: boolean) => {
      const id = randomUUID();
      const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
      const privateDataCiphertext = encryptOperationalData({ title: `Synthetic ${taskNumber}`, description: "Approval integration record" }, operationalContext({ organizationId, centreId, recordId: id }, "staff-task"));
      await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,approval_policy_id,approval_expires_at,escalation_owner_staff_id,escalation_due_at,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'GENERAL','NORMAL','AWAITING_APPROVAL',true,'PENDING',$6,CASE WHEN $7::uuid IS NULL THEN now()-interval '1 minute' ELSE NULL END,$7::uuid,CASE WHEN $7::uuid IS NULL THEN NULL ELSE now()-interval '1 minute' END,$8,$8,$9,$10)", [id, organizationId, centreId, taskNumber, privateDataCiphertext, policyId, withEscalation ? escalationOwnerId : null, staffUserId, randomUUID(), "e".repeat(64)]);
      const eventId = randomUUID();
      const submissionCiphertext = encryptOperationalData({ approvalSnapshotVersion: 1, approvalPolicyId: policyId, approvalPolicyVersion: 1, approvalApproverStaffIds: [actorId] }, operationalContext({ organizationId, centreId, recordId: eventId }, "staff-task-event"));
      await pool.query("INSERT INTO staff_task_events(id,organization_id,centre_id,task_id,event_type,private_data_ciphertext,actor_staff_id) VALUES($1,$2,$3,$4,'SUBMITTED_FOR_APPROVAL',$5,$6)", [eventId, organizationId, centreId, id, submissionCiphertext, staffUserId]);
      return id;
    };

    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId: actorId, grants: [{ key: "workspace.read", centreId }, { key: "tasks.read", centreId }, { key: "tasks.approve", centreId }] }, response: null });
    const actionRequest = (id: string, payload: unknown, key = randomUUID()) => new Request(`http://localhost/api/tasks/${id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(payload) });

    // A policy can outlive one of its named approvers' role assignments. Do
    // not submit work into a queue with no currently eligible named approver.
    const staleAuthId = randomUUID(); const staleApproverId = randomUUID();
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [staleAuthId, "Synthetic Inactive Approver", `${staleAuthId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [staleApproverId, staleAuthId, organizationId, `ST-${staleApproverId.slice(0, 8)}`, "Synthetic Inactive Approver"]);
    await pool.query("DELETE FROM staff_approval_policy_approvers WHERE organization_id=$1 AND policy_id=$2", [organizationId, policyId]);
    await pool.query("INSERT INTO staff_approval_policy_approvers(organization_id,policy_id,staff_id,created_by_staff_id) VALUES($1,$2,$3,$4)", [organizationId, policyId, staleApproverId, staffUserId]);
    const operationalCrypto = await import("@/server/operational-crypto");
    const creatorTaskId = randomUUID(); const creatorSubmissionId = randomUUID();
    await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,approval_policy_id,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'GENERAL','NORMAL','AWAITING_APPROVAL',true,'PENDING',$6,$7,$8,$9,$10)", [creatorTaskId, organizationId, centreId, `T-${creatorTaskId.slice(0, 8)}`, operationalCrypto.encryptOperationalData({ title: "Synthetic creator separation", description: "Creator must not approve own task" }, operationalCrypto.operationalContext({ organizationId, centreId, recordId: creatorTaskId }, "staff-task")), policyId, staffUserId, actorId, randomUUID(), "b".repeat(64)]);
    await pool.query("INSERT INTO staff_task_events(id,organization_id,centre_id,task_id,event_type,private_data_ciphertext,actor_staff_id) VALUES($1,$2,$3,$4,'SUBMITTED_FOR_APPROVAL',$5,$6)", [creatorSubmissionId, organizationId, centreId, creatorTaskId, operationalCrypto.encryptOperationalData({ approvalSnapshotVersion: 1, approvalPolicyId: policyId, approvalPolicyVersion: 1, approvalApproverStaffIds: [actorId] }, operationalCrypto.operationalContext({ organizationId, centreId, recordId: creatorSubmissionId }, "staff-task-event")), actorId]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId: actorId, grants: [{ key: "workspace.read", centreId }, { key: "tasks.read", centreId }, { key: "tasks.approve", centreId }] }, response: null });
    const creatorSelfApproval = await taskActionHandler(actionRequest(creatorTaskId, { expectedVersion: 1, action: "APPROVE", reason: "Synthetic creator self-approval attempt" }), { params: Promise.resolve({ id: creatorTaskId }) });
    expect(creatorSelfApproval.status).toBe(403);
    expect(await creatorSelfApproval.json()).toEqual({ error: "separation_of_duties" });
    expect((await pool.query("SELECT status,approval_status,version_number FROM staff_tasks WHERE id=$1", [creatorTaskId])).rows[0]).toMatchObject({ status: "AWAITING_APPROVAL", approval_status: "PENDING", version_number: 1 });
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "workspace.read", centreId }, { key: "tasks.read", centreId }, { key: "tasks.update", centreId }] }, response: null });
    const staleTaskId = randomUUID();
    const staleTaskPrivate = operationalCrypto.encryptOperationalData({ title: "Synthetic stale approver check", description: "Must fail closed" }, operationalCrypto.operationalContext({ organizationId, centreId, recordId: staleTaskId }, "staff-task"));
    await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'GENERAL','NORMAL','OPEN',true,'NOT_REQUIRED',$6,$6,$7,$8)", [staleTaskId, organizationId, centreId, `T-${staleTaskId.slice(0, 8)}`, staleTaskPrivate, staffUserId, randomUUID(), "a".repeat(64)]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "workspace.read", centreId }, { key: "tasks.read", centreId }, { key: "tasks.update", centreId }] }, response: null });
    const unavailable = await taskActionHandler(actionRequest(staleTaskId, { expectedVersion: 1, action: "SUBMIT_APPROVAL" }), { params: Promise.resolve({ id: staleTaskId }) });
    expect(unavailable.status).toBe(409);
    expect(await unavailable.json()).toEqual({ error: "approval_policy_approver_unavailable" });
    const unchangedStaleTask = await pool.query("SELECT status,approval_status,version_number FROM staff_tasks WHERE id=$1", [staleTaskId]);
    expect(unchangedStaleTask.rows[0]).toMatchObject({ status: "OPEN", approval_status: "NOT_REQUIRED", version_number: 1 });
    await pool.query("DELETE FROM staff_approval_policy_approvers WHERE organization_id=$1 AND policy_id=$2", [organizationId, policyId]);
    await pool.query("INSERT INTO staff_approval_policy_approvers(organization_id,policy_id,staff_id,created_by_staff_id) VALUES($1,$2,$3,$4)", [organizationId, policyId, actorId, staffUserId]);

    const reassignedTaskId = randomUUID(); const submissionEventId = randomUUID();
    const reassignedTaskPrivate = operationalCrypto.encryptOperationalData({ title: "Synthetic approval recovery", description: "Original reviewer is no longer eligible" }, operationalCrypto.operationalContext({ organizationId, centreId, recordId: reassignedTaskId }, "staff-task"));
    await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,approval_policy_id,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'GENERAL','NORMAL','AWAITING_APPROVAL',true,'PENDING',$6,$7,$7,$8,$9)", [reassignedTaskId, organizationId, centreId, `T-${reassignedTaskId.slice(0, 8)}`, reassignedTaskPrivate, policyId, staffUserId, randomUUID(), "b".repeat(64)]);
    const staleSubmission = operationalCrypto.encryptOperationalData({ approvalSnapshotVersion: 1, approvalPolicyId: policyId, approvalPolicyVersion: 1, approvalApproverStaffIds: [staleApproverId] }, operationalCrypto.operationalContext({ organizationId, centreId, recordId: submissionEventId }, "staff-task-event"));
    await pool.query("INSERT INTO staff_task_events(id,organization_id,centre_id,task_id,event_type,private_data_ciphertext,actor_staff_id) VALUES($1,$2,$3,$4,'SUBMITTED_FOR_APPROVAL',$5,$6)", [submissionEventId, organizationId, centreId, reassignedTaskId, staleSubmission, staffUserId]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId: actorId, grants: [{ key: "workspace.read", centreId }, { key: "tasks.read", centreId }, { key: "tasks.assign", centreId }, { key: "tasks.approve", centreId }] }, response: null });
    const reassignedParams = { params: Promise.resolve({ id: reassignedTaskId }) };
    const reassignReviewer = await taskActionHandler(actionRequest(reassignedTaskId, { expectedVersion: 1, action: "REASSIGN_APPROVER", approverStaffId: actorId, reason: "Original reviewer is no longer active" }), reassignedParams);
    expect(reassignReviewer.status, JSON.stringify(await reassignReviewer.clone().json())).toBe(200);
    expect(await reassignReviewer.json()).toMatchObject({ task: { id: reassignedTaskId, status: "AWAITING_APPROVAL", approvalStatus: "PENDING", versionNumber: 2 } });
    const reassignmentEventRows = await pool.query("SELECT id,event_type,private_data_ciphertext FROM staff_task_events WHERE task_id=$1 ORDER BY recorded_at,id", [reassignedTaskId]);
    expect(reassignmentEventRows.rows.map((row) => row.event_type)).toEqual(["SUBMITTED_FOR_APPROVAL", "APPROVER_REASSIGNED"]);
    const reviewerEvent = reassignmentEventRows.rows[1];
    expect(operationalCrypto.decryptOperationalData(reviewerEvent.private_data_ciphertext, operationalCrypto.operationalContext({ organizationId, centreId, recordId: reviewerEvent.id }, "staff-task-event"))).toMatchObject({ submissionEventId, approverStaffId: actorId, reason: "Original reviewer is no longer active" });
    const reassignReadback = await taskReadHandler(new Request(`http://localhost/api/tasks/${reassignedTaskId}`), reassignedParams);
    const reassignReadbackBody = await reassignReadback.json() as { task: { reassignableApprovers: Array<{ id: string }>; } ; history: Array<Record<string, unknown>> };
    expect(reassignReadbackBody.task.reassignableApprovers).toContainEqual(expect.objectContaining({ id: actorId }));
    const reassignmentHistory = reassignReadbackBody.history.find((event) => event.eventType === "APPROVER_REASSIGNED");
    expect(reassignmentHistory).toMatchObject({ approverName: "Synthetic Task Approver (ST-" + actorId.slice(0, 8) + ")" });
    expect(reassignmentHistory).not.toHaveProperty("approverStaffId");
    const unnecessaryReassignment = await taskActionHandler(actionRequest(reassignedTaskId, { expectedVersion: 2, action: "REASSIGN_APPROVER", approverStaffId: escalationOwnerId, reason: "Attempt to replace an available reviewer" }), reassignedParams);
    expect(unnecessaryReassignment.status).toBe(409);
    expect(await unnecessaryReassignment.json()).toEqual({ error: "approver_reassignment_not_required" });
    const approveRecovered = await taskActionHandler(actionRequest(reassignedTaskId, { expectedVersion: 2, action: "APPROVE", reason: "Independently reviewed after reassignment" }), reassignedParams);
    expect(approveRecovered.status, JSON.stringify(await approveRecovered.clone().json())).toBe(200);
    expect(await approveRecovered.json()).toMatchObject({ task: { id: reassignedTaskId, status: "COMPLETED", approvalStatus: "APPROVED", versionNumber: 3 } });

    const changesTaskId = await makeTask(`T-${randomUUID().slice(0, 8)}`, true);
    const changesTaskParams = { params: Promise.resolve({ id: changesTaskId }) };
    const changesReason = "Synthetic request: attach the required completion evidence";
    const changesKey = randomUUID();
    const changeRequest = () => taskActionHandler(actionRequest(changesTaskId, { expectedVersion: 1, action: "REQUEST_CHANGES", reason: changesReason }, changesKey), changesTaskParams);
    const changesResponse = await changeRequest();
    expect(changesResponse.status, JSON.stringify(await changesResponse.clone().json())).toBe(200);
    expect(await changesResponse.json()).toMatchObject({ task: { id: changesTaskId, status: "IN_PROGRESS", approvalStatus: "CHANGES_REQUESTED", versionNumber: 2 }, replayed: false });
    const changesReplay = await changeRequest();
    expect(changesReplay.status).toBe(200);
    expect(await changesReplay.json()).toMatchObject({ task: { status: "IN_PROGRESS", approvalStatus: "CHANGES_REQUESTED", versionNumber: 2 }, replayed: true });
    const changesEvents = await pool.query("SELECT id,event_type,private_data_ciphertext FROM staff_task_events WHERE task_id=$1 ORDER BY recorded_at,id", [changesTaskId]);
    expect(changesEvents.rows.map((row) => row.event_type)).toEqual(["SUBMITTED_FOR_APPROVAL", "CHANGES_REQUESTED"]);
    expect(operationalCrypto.decryptOperationalData(changesEvents.rows[1].private_data_ciphertext, operationalCrypto.operationalContext({ organizationId, centreId, recordId: changesEvents.rows[1].id }, "staff-task-event"))).toMatchObject({ reason: changesReason, privateRequest: { reason: changesReason } });
    expect((await pool.query("SELECT status,approval_status,approval_expires_at,escalation_owner_staff_id,escalation_due_at,version_number FROM staff_tasks WHERE id=$1", [changesTaskId])).rows[0]).toMatchObject({ status: "IN_PROGRESS", approval_status: "CHANGES_REQUESTED", approval_expires_at: null, escalation_owner_staff_id: null, escalation_due_at: null, version_number: 2 });

    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "workspace.read", centreId }, { key: "tasks.read", centreId }, { key: "tasks.assigned.read", centreId }, { key: "tasks.update", centreId }] }, response: null });
    const resubmitted = await taskActionHandler(actionRequest(changesTaskId, { expectedVersion: 2, action: "SUBMIT_APPROVAL" }), changesTaskParams);
    expect(resubmitted.status, JSON.stringify(await resubmitted.clone().json())).toBe(200);
    expect(await resubmitted.json()).toMatchObject({ task: { id: changesTaskId, status: "AWAITING_APPROVAL", approvalStatus: "PENDING", versionNumber: 3 }, replayed: false });
    const resubmissionEvents = await pool.query("SELECT id,event_type,private_data_ciphertext FROM staff_task_events WHERE task_id=$1 ORDER BY recorded_at,id", [changesTaskId]);
    expect(resubmissionEvents.rows.map((row) => row.event_type)).toEqual(["SUBMITTED_FOR_APPROVAL", "CHANGES_REQUESTED", "SUBMITTED_FOR_APPROVAL"]);
    expect(operationalCrypto.decryptOperationalData(resubmissionEvents.rows[2].private_data_ciphertext, operationalCrypto.operationalContext({ organizationId, centreId, recordId: resubmissionEvents.rows[2].id }, "staff-task-event"))).toMatchObject({ approvalSnapshotVersion: 1, approvalPolicyId: policyId, approvalPolicyVersion: 1, approvalApproverStaffIds: [actorId] });

    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId: actorId, grants: [{ key: "workspace.read", centreId }, { key: "tasks.read", centreId }, { key: "tasks.assign", centreId }, { key: "tasks.approve", centreId }] }, response: null });
    const roleBasedTaskId = randomUUID(); const roleBasedSubmissionId = randomUUID();
    const roleBasedPrivate = operationalCrypto.encryptOperationalData({ title: "Synthetic role-based approval", description: "Empty snapshot means any scoped approver" }, operationalCrypto.operationalContext({ organizationId, centreId, recordId: roleBasedTaskId }, "staff-task"));
    await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,approval_policy_id,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'GENERAL','NORMAL','AWAITING_APPROVAL',true,'PENDING',$6,$7,$7,$8,$9)", [roleBasedTaskId, organizationId, centreId, `T-${roleBasedTaskId.slice(0, 8)}`, roleBasedPrivate, policyId, staffUserId, randomUUID(), "c".repeat(64)]);
    const roleBasedSubmission = operationalCrypto.encryptOperationalData({ approvalSnapshotVersion: 1, approvalPolicyId: policyId, approvalPolicyVersion: 1, approvalApproverStaffIds: [] }, operationalCrypto.operationalContext({ organizationId, centreId, recordId: roleBasedSubmissionId }, "staff-task-event"));
    await pool.query("INSERT INTO staff_task_events(id,organization_id,centre_id,task_id,event_type,private_data_ciphertext,actor_staff_id) VALUES($1,$2,$3,$4,'SUBMITTED_FOR_APPROVAL',$5,$6)", [roleBasedSubmissionId, organizationId, centreId, roleBasedTaskId, roleBasedSubmission, staffUserId]);
    const roleBasedParams = { params: Promise.resolve({ id: roleBasedTaskId }) };
    const unnecessaryRoleBasedReassignment = await taskActionHandler(actionRequest(roleBasedTaskId, { expectedVersion: 1, action: "REASSIGN_APPROVER", approverStaffId: escalationOwnerId, reason: "Role-based approvals need no reviewer replacement" }), roleBasedParams);
    expect(unnecessaryRoleBasedReassignment.status).toBe(409);
    expect(await unnecessaryRoleBasedReassignment.json()).toEqual({ error: "approver_reassignment_not_required" });
    const roleBasedReadback = await taskReadHandler(new Request(`http://localhost/api/tasks/${roleBasedTaskId}`), roleBasedParams);
    const roleBasedReadbackBody = await roleBasedReadback.json() as { task: Record<string, unknown> };
    expect(roleBasedReadbackBody.task).not.toHaveProperty("reassignableApprovers");

    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId: actorId, grants: [{ key: "workspace.read", centreId }, { key: "tasks.read", centreId }, { key: "tasks.approve", centreId }] }, response: null });
    const expiryTaskId = await makeTask(`T-${randomUUID().slice(0, 8)}`, false);
    const expiryParams = { params: Promise.resolve({ id: expiryTaskId }) };
    const expiryKey = randomUUID();
    const expiryBody = { expectedVersion: 1, action: "EXPIRE_APPROVAL", reason: "Synthetic approval deadline elapsed" };
    const expiryResponses = await Promise.all([taskActionHandler(actionRequest(expiryTaskId, expiryBody, expiryKey), expiryParams), taskActionHandler(actionRequest(expiryTaskId, expiryBody, expiryKey), expiryParams)]);
    expect(expiryResponses.map((response) => response.status)).toEqual([200, 200]);
    const expiryBodies = await Promise.all(expiryResponses.map((response) => response.json())) as Array<{ task: { id: string; status: string; approvalStatus: string; versionNumber: number }; replayed: boolean }>;
    expect(expiryBodies.map((body) => body.replayed).sort()).toEqual([false, true]);
    expect(expiryBodies[0]).toMatchObject({ task: { id: expiryTaskId, status: "IN_PROGRESS", approvalStatus: "EXPIRED", versionNumber: 2 } });
    const expiryPersisted = await pool.query("SELECT status,approval_status,approval_expires_at,version_number FROM staff_tasks WHERE id=$1", [expiryTaskId]);
    expect(expiryPersisted.rows[0]).toMatchObject({ status: "IN_PROGRESS", approval_status: "EXPIRED", approval_expires_at: null, version_number: 2 });
    const expiryHistory = await pool.query("SELECT event_type FROM staff_task_events WHERE task_id=$1 ORDER BY recorded_at,id", [expiryTaskId]);
    expect(expiryHistory.rows.map((row) => row.event_type)).toEqual(["SUBMITTED_FOR_APPROVAL", "APPROVAL_EXPIRED"]);
    const expiryReplay = await taskActionHandler(actionRequest(expiryTaskId, { expectedVersion: 2, action: "EXPIRE_APPROVAL", reason: "Synthetic approval deadline elapsed" }, expiryKey), expiryParams);
    expect(expiryReplay.status).toBe(200);
    expect(await expiryReplay.json()).toMatchObject({ task: { versionNumber: 2, approvalStatus: "EXPIRED" }, replayed: true });
    const expiryMismatch = await taskActionHandler(actionRequest(expiryTaskId, { expectedVersion: 2, action: "EXPIRE_APPROVAL", reason: "Changed reason" }, expiryKey), expiryParams);
    expect(expiryMismatch.status).toBe(409);
    expect(await expiryMismatch.json()).toEqual({ error: "idempotency_conflict" });
    const staleExpiry = await taskActionHandler(actionRequest(expiryTaskId, { expectedVersion: 1, action: "EXPIRE_APPROVAL", reason: "Synthetic replay attempt" }), expiryParams);
    expect(staleExpiry.status).toBe(409);
    expect((await pool.query("SELECT count(*)::int AS count FROM staff_task_events WHERE task_id=$1", [expiryTaskId])).rows[0].count).toBe(2);

    const escalationTaskId = await makeTask(`T-${randomUUID().slice(0, 8)}`, true);
    const escalationParams = { params: Promise.resolve({ id: escalationTaskId }) };
    const crossTaskReplay = await taskActionHandler(actionRequest(escalationTaskId, expiryBody, expiryKey), escalationParams);
    expect(crossTaskReplay.status).toBe(409);
    expect(await crossTaskReplay.json()).toEqual({ error: "idempotency_conflict" });
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId: escalationOwnerId, grants: [{ key: "workspace.read", centreId }, { key: "tasks.assigned.read", centreId }, { key: "tasks.approve", centreId }] }, response: null });
    const beforeEscalationDecision = await taskActionHandler(actionRequest(escalationTaskId, { expectedVersion: 1, action: "APPROVE", reason: "Must remain unavailable before escalation" }), escalationParams);
    expect(beforeEscalationDecision.status).toBe(404);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId: actorId, grants: [{ key: "workspace.read", centreId }, { key: "tasks.read", centreId }, { key: "tasks.approve", centreId }] }, response: null });
    const trigger = await taskActionHandler(actionRequest(escalationTaskId, { expectedVersion: 1, action: "TRIGGER_ESCALATION" }), escalationParams);
    expect(trigger.status, JSON.stringify(await trigger.clone().json())).toBe(200);
    expect(await trigger.json()).toMatchObject({ task: { id: escalationTaskId, status: "AWAITING_APPROVAL", approvalStatus: "PENDING", versionNumber: 2 } });
    const escalationPersisted = await pool.query("SELECT status,escalation_processed_at,version_number FROM staff_tasks WHERE id=$1", [escalationTaskId]);
    expect(escalationPersisted.rows[0]).toMatchObject({ status: "AWAITING_APPROVAL", version_number: 2 });
    expect(escalationPersisted.rows[0].escalation_processed_at).toBeInstanceOf(Date);
    const escalationHistory = await pool.query("SELECT event_type FROM staff_task_events WHERE task_id=$1 ORDER BY recorded_at,id", [escalationTaskId]);
    expect(escalationHistory.rows.map((row) => row.event_type)).toEqual(["SUBMITTED_FOR_APPROVAL", "ESCALATED"]);
    const replayEscalation = await taskActionHandler(actionRequest(escalationTaskId, { expectedVersion: 2, action: "TRIGGER_ESCALATION" }), escalationParams);
    expect(replayEscalation.status).toBe(409);
    expect(await replayEscalation.json()).toEqual({ error: "escalation_not_due" });
    expect((await pool.query("SELECT count(*)::int AS count FROM staff_task_events WHERE task_id=$1", [escalationTaskId])).rows[0].count).toBe(2);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId: escalationOwnerId, grants: [{ key: "workspace.read", centreId }, { key: "tasks.assigned.read", centreId }, { key: "tasks.approve", centreId }] }, response: null });
    const escalationDecision = await taskActionHandler(actionRequest(escalationTaskId, { expectedVersion: 2, action: "APPROVE", reason: "Synthetic escalated approval decision" }), escalationParams);
    expect(escalationDecision.status, JSON.stringify(await escalationDecision.clone().json())).toBe(200);
    expect(await escalationDecision.json()).toMatchObject({ task: { id: escalationTaskId, status: "COMPLETED", approvalStatus: "APPROVED", versionNumber: 3 } });
    const decisionHistory = await pool.query("SELECT event_type,actor_staff_id FROM staff_task_events WHERE task_id=$1 ORDER BY recorded_at,id", [escalationTaskId]);
    expect(decisionHistory.rows.map((row) => [row.event_type, row.actor_staff_id])).toEqual([["SUBMITTED_FOR_APPROVAL", staffUserId], ["ESCALATED", actorId], ["APPROVED", escalationOwnerId]]);

    const { processDueTaskApprovalDeadlines } = await import("@/server/approval-deadline-worker");
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    const systemExpiryId = randomUUID();
    await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,approval_expires_at,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'GENERAL','NORMAL','AWAITING_APPROVAL',true,'PENDING','2000-01-01T00:00:00Z',$6,$6,$7,$8)", [systemExpiryId, organizationId, centreId, `T-${systemExpiryId.slice(0, 8)}`, encryptOperationalData({ title: "Synthetic system expiry", description: "worker integration" }, operationalContext({ organizationId, centreId, recordId: systemExpiryId }, "staff-task")), staffUserId, randomUUID(), "f".repeat(64)]);
    const systemEscalationId = randomUUID();
    await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,approval_policy_id,escalation_owner_staff_id,escalation_due_at,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'GENERAL','NORMAL','AWAITING_APPROVAL',true,'PENDING',$6,$7,'2000-01-01T00:00:00Z',$8,$8,$9,$10)", [systemEscalationId, organizationId, centreId, `T-${systemEscalationId.slice(0, 8)}`, encryptOperationalData({ title: "Synthetic system escalation", description: "worker integration" }, operationalContext({ organizationId, centreId, recordId: systemEscalationId }, "staff-task")), policyId, escalationOwnerId, staffUserId, randomUUID(), "a".repeat(64)]);
    const invalidOwnerEscalationIds = Array.from({ length: 55 }, () => randomUUID());
    const invalidOwnerValues: unknown[] = [];
    const invalidOwnerRows = invalidOwnerEscalationIds.map((invalidOwnerEscalationId, index) => {
      const offset = index * 11;
      invalidOwnerValues.push(invalidOwnerEscalationId, organizationId, centreId, `T-${invalidOwnerEscalationId.slice(0, 8)}`, encryptOperationalData({ title: "Synthetic invalid escalation owner", description: "must not starve valid due work" }, operationalContext({ organizationId, centreId, recordId: invalidOwnerEscalationId }, "staff-task")), policyId, staffUserId, staffUserId, staffUserId, randomUUID(), "c".repeat(64));
      return `($${offset + 1},$${offset + 2},$${offset + 3},$${offset + 4},$${offset + 5},'GENERAL','NORMAL','AWAITING_APPROVAL',true,'PENDING',$${offset + 6},$${offset + 7},'1999-12-31T00:00:00Z',$${offset + 8},$${offset + 9},$${offset + 10},$${offset + 11})`;
    });
    await pool.query(`INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,approval_policy_id,escalation_owner_staff_id,escalation_due_at,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES ${invalidOwnerRows.join(",")}`, invalidOwnerValues);
    const unreadableOwnerAuthId = randomUUID(); const unreadableOwnerId = randomUUID(); const unreadableOwnerRoleId = randomUUID();
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [unreadableOwnerAuthId, "Synthetic Approval-Only Owner", `${unreadableOwnerAuthId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [unreadableOwnerId, unreadableOwnerAuthId, organizationId, `ST-${unreadableOwnerId.slice(0, 8)}`, "Synthetic Approval-Only Owner"]);
    await pool.query("INSERT INTO roles(id,organization_id,key,name,scope,is_system) VALUES($1,$2,$3,$4,'CENTRE',false)", [unreadableOwnerRoleId, organizationId, `approval_only_${unreadableOwnerRoleId.slice(0, 8)}`, "Synthetic approval-only role"]);
    await pool.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key='tasks.approve' ON CONFLICT DO NOTHING", [unreadableOwnerRoleId]);
    await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, unreadableOwnerId, unreadableOwnerRoleId, centreId]);
    const unreadableOwnerTaskId = randomUUID();
    await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,approval_policy_id,escalation_owner_staff_id,escalation_due_at,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'GENERAL','NORMAL','AWAITING_APPROVAL',true,'PENDING',$6,$7,'1999-12-31T00:00:00Z',$8,$8,$9,$10)", [unreadableOwnerTaskId, organizationId, centreId, `T-${unreadableOwnerTaskId.slice(0, 8)}`, encryptOperationalData({ title: "Synthetic unreadable escalation owner", description: "Must remain pending until access is restored" }, operationalContext({ organizationId, centreId, recordId: unreadableOwnerTaskId }, "staff-task")), policyId, unreadableOwnerId, staffUserId, randomUUID(), "e".repeat(64)]);
    const workerNow = new Date("2000-01-02T00:00:00Z");
    const processed = await processDueTaskApprovalDeadlines(50, workerNow);
    expect(processed).toMatchObject({ expired: 1, escalated: 1, skippedInvalidOwner: 56, processed: 2 });
    const systemEvents = await pool.query("SELECT task_id,event_type,actor_type,actor_staff_id FROM staff_task_events WHERE task_id=ANY($1::uuid[]) AND actor_type='SYSTEM' ORDER BY event_type", [[systemExpiryId, systemEscalationId]]);
    expect(systemEvents.rows).toEqual([
      { task_id: systemExpiryId, event_type: "APPROVAL_EXPIRED", actor_type: "SYSTEM", actor_staff_id: null },
      { task_id: systemEscalationId, event_type: "ESCALATED", actor_type: "SYSTEM", actor_staff_id: null },
    ]);
    expect((await pool.query("SELECT status,approval_status FROM staff_tasks WHERE id=$1", [systemExpiryId])).rows[0]).toMatchObject({ status: "IN_PROGRESS", approval_status: "EXPIRED" });
    expect((await pool.query("SELECT escalation_processed_at FROM staff_tasks WHERE id=$1", [systemEscalationId])).rows[0].escalation_processed_at).toBeInstanceOf(Date);
    const invalidOwnerState = await pool.query("SELECT count(*)::int AS untouched FROM staff_tasks WHERE id=ANY($1::uuid[]) AND escalation_processed_at IS NULL AND status='AWAITING_APPROVAL'", [invalidOwnerEscalationIds]);
    expect(invalidOwnerState.rows[0].untouched).toBe(55);
    expect((await pool.query("SELECT count(*)::int AS count FROM staff_task_events WHERE task_id=ANY($1::uuid[])", [invalidOwnerEscalationIds])).rows[0].count).toBe(0);
    expect((await pool.query("SELECT escalation_processed_at,status FROM staff_tasks WHERE id=$1", [unreadableOwnerTaskId])).rows[0]).toMatchObject({ escalation_processed_at: null, status: "AWAITING_APPROVAL" });
    expect((await pool.query("SELECT count(*)::int AS count FROM staff_task_events WHERE task_id=$1", [unreadableOwnerTaskId])).rows[0].count).toBe(0);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId: actorId, grants: [{ key: "workspace.read", centreId }, { key: "tasks.read", centreId }, { key: "tasks.assign", centreId }, { key: "tasks.approve", centreId }] }, response: null });
    const unreadableOwnerManualEscalation = await taskActionHandler(actionRequest(unreadableOwnerTaskId, { expectedVersion: 1, action: "TRIGGER_ESCALATION" }), { params: Promise.resolve({ id: unreadableOwnerTaskId }) });
    expect(unreadableOwnerManualEscalation.status).toBe(403);
    expect(await unreadableOwnerManualEscalation.json()).toEqual({ error: "approver_not_eligible" });
    expect((await pool.query("SELECT escalation_processed_at,version_number FROM staff_tasks WHERE id=$1", [unreadableOwnerTaskId])).rows[0]).toMatchObject({ escalation_processed_at: null, version_number: 1 });
    await pool.query("UPDATE staff_tasks SET status='CANCELLED', approval_status='NOT_REQUIRED' WHERE id=ANY($1::uuid[])", [invalidOwnerEscalationIds]);
    await pool.query("UPDATE staff_tasks SET status='CANCELLED', approval_status='NOT_REQUIRED' WHERE id=$1", [unreadableOwnerTaskId]);
    expect((await processDueTaskApprovalDeadlines(50, workerNow))).toMatchObject({ processed: 0, expired: 0, escalated: 0 });
    // Competing deadline workers must emit only one system transition per row.
    const concurrentExpiryId = randomUUID();
    await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,approval_expires_at,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'GENERAL','NORMAL','AWAITING_APPROVAL',true,'PENDING','2000-01-01T00:00:00Z',$6,$6,$7,$8)", [concurrentExpiryId, organizationId, centreId, `T-${concurrentExpiryId.slice(0, 8)}`, encryptOperationalData({ title: "Synthetic concurrent expiry", description: "Two worker race" }, operationalContext({ organizationId, centreId, recordId: concurrentExpiryId }, "staff-task")), staffUserId, randomUUID(), "d".repeat(64)]);
    const concurrentEscalationId = randomUUID();
    await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,approval_policy_id,escalation_owner_staff_id,escalation_due_at,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'GENERAL','NORMAL','AWAITING_APPROVAL',true,'PENDING',$6,$7,'2000-01-01T00:00:00Z',$8,$8,$9,$10)", [concurrentEscalationId, organizationId, centreId, `T-${concurrentEscalationId.slice(0, 8)}`, encryptOperationalData({ title: "Synthetic concurrent escalation", description: "Two worker race" }, operationalContext({ organizationId, centreId, recordId: concurrentEscalationId }, "staff-task")), policyId, escalationOwnerId, staffUserId, randomUUID(), "e".repeat(64)]);
    const concurrentWorkerResults = await Promise.all([processDueTaskApprovalDeadlines(50, workerNow), processDueTaskApprovalDeadlines(50, workerNow)]);
    expect(concurrentWorkerResults.reduce((sum, result) => sum + result.expired, 0)).toBe(1);
    expect(concurrentWorkerResults.reduce((sum, result) => sum + result.escalated, 0)).toBe(1);
    const concurrentEvents = await pool.query("SELECT task_id,event_type FROM staff_task_events WHERE task_id=ANY($1::uuid[]) AND actor_type='SYSTEM'", [[concurrentExpiryId, concurrentEscalationId]]);
    expect(concurrentEvents.rows).toHaveLength(2);
    expect(new Set(concurrentEvents.rows.map((row) => `${row.task_id}:${row.event_type}`))).toEqual(new Set([`${concurrentExpiryId}:APPROVAL_EXPIRED`, `${concurrentEscalationId}:ESCALATED`]));
    expect((await pool.query("SELECT status,approval_status,escalation_processed_at FROM staff_tasks WHERE id=$1", [concurrentExpiryId])).rows[0]).toMatchObject({ status: "IN_PROGRESS", approval_status: "EXPIRED", escalation_processed_at: null });
    expect((await pool.query("SELECT status,approval_status,escalation_processed_at FROM staff_tasks WHERE id=$1", [concurrentEscalationId])).rows[0]).toMatchObject({ status: "AWAITING_APPROVAL", approval_status: "PENDING", escalation_processed_at: expect.any(Date) });
    await pool.query("UPDATE staff_tasks SET status='CANCELLED', approval_status='NOT_REQUIRED', approval_expires_at=NULL, escalation_owner_staff_id=NULL, escalation_due_at=NULL WHERE id=ANY($1::uuid[])", [[concurrentExpiryId, concurrentEscalationId]]);
    const scopedCentreId = randomUUID();
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [scopedCentreId, organizationId, `S-${scopedCentreId.slice(0, 8)}`, "Synthetic Scoped Approval Centre"]);
    const scopedDueTaskId = randomUUID();
    await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,approval_expires_at,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'GENERAL','NORMAL','AWAITING_APPROVAL',true,'PENDING','2000-01-01T00:00:00Z',$6,$6,$7,$8)", [scopedDueTaskId, organizationId, scopedCentreId, `T-${scopedDueTaskId.slice(0, 8)}`, encryptOperationalData({ title: "Synthetic out-of-scope due approval", description: "scope test" }, operationalContext({ organizationId, centreId: scopedCentreId, recordId: scopedDueTaskId }, "staff-task")), staffUserId, randomUUID(), "b".repeat(64)]);
    expect(await processDueTaskApprovalDeadlines(50, workerNow, { organizationId, centreIds: [centreId], triggeredByStaffId: actorId })).toMatchObject({ processed: 0 });
    expect((await pool.query("SELECT approval_status FROM staff_tasks WHERE id=$1", [scopedDueTaskId])).rows[0].approval_status).toBe("PENDING");
    expect(await processDueTaskApprovalDeadlines(50, workerNow, { organizationId, centreIds: [scopedCentreId], triggeredByStaffId: actorId })).toMatchObject({ expired: 1, processed: 1 });
    expect((await pool.query("SELECT actor_staff_id,details->>'initiatedByStaff' AS initiated FROM audit_events WHERE organization_id=$1 AND entity_id=$2 AND action='staff_task.approval_expired'", [organizationId, scopedDueTaskId])).rows[0]).toMatchObject({ actor_staff_id: actorId, initiated: "true" });
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }, { key: "appointments.update", centreId }, { key: "appointments.assign", centreId }, { key: "roster.read", centreId }, { key: "finance.read", centreId }] }, response: null });
  });

  it("joins an authorized booking into the centre operations queue without patient details", async () => {
    const created = await handler(request(randomUUID()));
    expect(created.status).toBe(201);
    const booking = await created.json() as { appointment: { id: string; appointmentNumber: string } };
    const response = await operationsHandler();
    expect(response.status).toBe(200);
    const payload = await response.json() as { centres: Array<{ id: string; queue: Array<{ id: string; kind: string; reference: string; title: string }> }> };
    const summary = payload.centres.find((item) => item.id === centreId);
    expect(summary?.queue).toContainEqual(expect.objectContaining({ id: booking.appointment.id, kind: "APPOINTMENT", reference: booking.appointment.appointmentNumber, title: "Booking confirmation" }));
    expect(JSON.stringify(summary?.queue)).not.toContain("Synthetic Booking Patient");
  });

  it("puts due approval deadlines in the manager queue only with task-read and approval grants", async () => {
    const taskId = randomUUID();
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    const privateDataCiphertext = encryptOperationalData({ title: "Synthetic private approval detail", description: "Sensitive operational note" }, operationalContext({ organizationId, centreId, recordId: taskId }, "staff-task"));
    await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,approval_expires_at,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'OPERATIONS','HIGH','AWAITING_APPROVAL',true,'PENDING',now()-interval '1 hour',$6,$6,$7,$8)", [taskId, organizationId, centreId, `T-${taskId.slice(0, 8)}`, privateDataCiphertext, staffUserId, randomUUID(), "a".repeat(64)]);
    const escalationTaskId = randomUUID();
    const escalationPrivateData = encryptOperationalData({ title: "Synthetic escalation private detail", description: "Private escalation note" }, operationalContext({ organizationId, centreId, recordId: escalationTaskId }, "staff-task"));
    await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,escalation_owner_staff_id,escalation_due_at,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'OPERATIONS','HIGH','AWAITING_APPROVAL',true,'PENDING',$6,now()-interval '30 minutes',$6,$6,$7,$8)", [escalationTaskId, organizationId, centreId, `T-${escalationTaskId.slice(0, 8)}`, escalationPrivateData, staffUserId, randomUUID(), "b".repeat(64)]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }, { key: "tasks.read", centreId }, { key: "tasks.approve", centreId }] }, response: null });
    const managerResponse = await operationsHandler();
    expect(managerResponse.status).toBe(200);
    const managerPayload = await managerResponse.json() as { centres: Array<{ id: string; metrics: Record<string, number>; queue: Array<{ id: string; kind: string; reference: string; title: string; href: string }> }> };
    const managerCentre = managerPayload.centres.find((item) => item.id === centreId)!;
    expect(managerCentre.metrics).toMatchObject({ taskApprovalExpiryDue: 1, taskApprovalEscalationDue: 1 });
    expect(managerCentre.queue).toContainEqual(expect.objectContaining({ id: taskId, kind: "TASK_APPROVAL_EXPIRY", reference: `T-${taskId.slice(0, 8)}`, href: `/tasks/approvals?queue=expiry-due&taskId=${taskId}&centreId=${centreId}` }));
    expect(managerCentre.queue).toContainEqual(expect.objectContaining({ id: escalationTaskId, kind: "TASK_APPROVAL_ESCALATION", reference: `T-${escalationTaskId.slice(0, 8)}`, href: `/tasks/approvals?queue=escalation-due&taskId=${escalationTaskId}&centreId=${centreId}` }));
    expect(JSON.stringify(managerCentre.queue)).not.toContain("Synthetic private approval detail");
    expect(JSON.stringify(managerCentre.queue)).not.toContain("Sensitive operational note");
    expect(JSON.stringify(managerCentre.queue)).not.toContain("Synthetic escalation private detail");
    expect(JSON.stringify(managerCentre.queue)).not.toContain("Private escalation note");

    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }, { key: "tasks.read", centreId }] }, response: null });
    const limitedResponse = await operationsHandler();
    const limitedCentre = ((await limitedResponse.json()) as typeof managerPayload).centres.find((item) => item.id === centreId)!;
    expect(limitedCentre.metrics).not.toHaveProperty("taskApprovalExpiryDue");
    expect(limitedCentre.metrics).not.toHaveProperty("taskApprovalEscalationDue");
    expect(limitedCentre.queue.some((item) => item.kind === "TASK_APPROVAL_EXPIRY")).toBe(false);
    expect(limitedCentre.queue.some((item) => item.kind === "TASK_APPROVAL_ESCALATION")).toBe(false);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }, { key: "appointments.update", centreId }, { key: "appointments.assign", centreId }, { key: "roster.read", centreId }, { key: "finance.read", centreId }] }, response: null });
  });

  it("links assigned-only staff queue entries to the specific task without broad task access", async () => {
    const taskId = randomUUID();
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    const privateDataCiphertext = encryptOperationalData({ title: "Synthetic assigned task", description: "Assigned-only detail link" }, operationalContext({ organizationId, centreId, recordId: taskId }, "staff-task"));
    // Keep this fixture inside the oldest-due portion of the intentionally
    // capped queue preview even after earlier integration cases seed tasks.
    await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash,due_at) VALUES($1,$2,$3,$4,$5,'GENERAL','NORMAL','OPEN',false,'NOT_REQUIRED',$6,$6,$7,$8,now()-interval '100 years')", [taskId, organizationId, centreId, `T-${taskId.slice(0, 8)}`, privateDataCiphertext, staffUserId, randomUUID(), "f".repeat(64)]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "tasks.assigned.read", centreId }] }, response: null });

    const response = await operationsHandler();
    const body = await response.json() as { centres: Array<{ queue: Array<{ id: string; kind: string; href: string }> }> };
    expect(response.status).toBe(200);
    expect(body.centres[0]?.queue).toContainEqual(expect.objectContaining({ id: taskId, kind: "TASK", href: `/tasks?taskId=${taskId}&centreId=${centreId}` }));
  });

  it("filters approval escalations to due, unprocessed work", async () => {
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    const pendingId = randomUUID();
    const processedId = randomUUID();
    const exceptionId = randomUUID();
    const encryptedTask = (id: string) => encryptOperationalData({ title: "Synthetic escalation filter task", description: "Private synthetic detail" }, operationalContext({ organizationId, centreId, recordId: id }, "staff-task"));
    const insertDueTask = (id: string, taskNumber: string, processed: boolean) => pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,escalation_owner_staff_id,escalation_due_at,escalation_processed_at,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'GENERAL','HIGH','AWAITING_APPROVAL',true,'PENDING',$6,now()-interval '30 minutes',$7,$6,$6,$8,$9)", [id, organizationId, centreId, taskNumber, encryptedTask(id), staffUserId, processed ? new Date() : null, randomUUID(), processed ? "c".repeat(64) : "d".repeat(64)]);
    await insertDueTask(pendingId, `T-${pendingId.slice(0, 8)}`, false);
    await insertDueTask(processedId, `T-${processedId.slice(0, 8)}`, true);
    await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'EXCEPTION_REVIEW','NORMAL','OPEN',false,'NOT_REQUIRED',$6,$6,$7,$8)", [exceptionId, organizationId, centreId, `T-${exceptionId.slice(0, 8)}`, encryptedTask(exceptionId), staffUserId, randomUUID(), "e".repeat(64)]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "tasks.read", centreId }] }, response: null });
    const response = await taskListHandler(new Request("http://localhost/api/tasks?status=APPROVAL_ESCALATION_DUE"));
    expect(response.status).toBe(200);
    const body = await response.json() as { tasks: Array<{ id: string }> };
    const visibleIds = body.tasks.map((task) => task.id);
    expect(visibleIds).toContain(pendingId);
    expect(visibleIds).not.toContain(processedId);
    expect(visibleIds).not.toContain(exceptionId);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }, { key: "appointments.update", centreId }, { key: "appointments.assign", centreId }, { key: "roster.read", centreId }, { key: "finance.read", centreId }] }, response: null });
  });

  it("joins payment and refund review into the finance-authorized centre queue without amounts or private references", async () => {
    const { encryptFinanceReportPrivateData } = await import("@/server/finance-report-crypto");
    const paymentId = randomUUID();
    const disputedPaymentId = randomUUID();
    const refundId = randomUUID();
    const privatePayment = (id: string) => encryptFinanceReportPrivateData("finance-payment", { reference: "SYNTHETIC-PRIVATE-REFERENCE" }, { organizationId, centreId, recordId: id });
    await pool.query("INSERT INTO finance_payments(id,organization_id,centre_id,payment_number,method,status,amount_minor,private_data_ciphertext,received_by_staff_id,idempotency_key) VALUES($1,$2,$3,$4,'UPI','RECORDED',987654321,$5,$6,$7),($8,$2,$3,$9,'CARD_TERMINAL','DISPUTED',123456789,$10,$6,$11)", [paymentId, organizationId, centreId, `PAY-${paymentId.slice(0, 8)}`, privatePayment(paymentId), staffUserId, randomUUID(), disputedPaymentId, `PAY-${disputedPaymentId.slice(0, 8)}`, privatePayment(disputedPaymentId), randomUUID()]);
    const privateRefund = encryptFinanceReportPrivateData("finance-refund", { reason: "Synthetic refund reason", executionReference: null }, { organizationId, centreId, recordId: refundId });
    await pool.query("INSERT INTO finance_refunds(id,organization_id,centre_id,payment_id,amount_minor,status,requested_by_staff_id,private_data_ciphertext) VALUES($1,$2,$3,$4,5000,'REQUESTED',$5,$6)", [refundId, organizationId, centreId, paymentId, staffUserId, privateRefund]);

    const response = await operationsHandler();
    expect(response.status).toBe(200);
    const payload = await response.json() as { centres: Array<{ id: string; metrics: Record<string, number>; queue: Array<{ id: string; kind: string; reference: string; title: string }> }> };
    const summary = payload.centres.find((item) => item.id === centreId)!;
    expect(summary.metrics).toMatchObject({ financePendingPayments: 1, financeDisputes: 1, financeRefundRequests: 1 });
    expect(summary.queue).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: paymentId, kind: "FINANCE_PAYMENT", title: "Payment awaiting review" }),
      expect.objectContaining({ id: disputedPaymentId, kind: "FINANCE_DISPUTE", title: "Disputed payment review" }),
      expect.objectContaining({ id: refundId, kind: "FINANCE_REFUND", title: "Refund request awaiting review" }),
    ]));
    const serializedQueue = JSON.stringify(summary.queue);
    expect(serializedQueue).not.toContain("987654321");
    expect(serializedQueue).not.toContain("123456789");
    expect(serializedQueue).not.toContain("SYNTHETIC-PRIVATE-REFERENCE");
    expect(serializedQueue).not.toContain("Synthetic refund reason");

    mocks.getApiAccess.mockResolvedValueOnce({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }] }, response: null });
    const withoutFinance = await operationsHandler();
    const limited = (await withoutFinance.json() as typeof payload).centres.find((item) => item.id === centreId)!;
    expect(limited.metrics).not.toHaveProperty("financePendingPayments");
    expect(limited.metrics).not.toHaveProperty("financeDisputes");
    expect(limited.metrics).not.toHaveProperty("financeRefundRequests");
    expect(limited.queue.some((item) => item.kind.startsWith("FINANCE_"))).toBe(false);
  });

  it("surfaces only centre-scoped pending public enquiries to lead readers without private details", async () => {
    const { encryptLeadValue } = await import("@/server/lead-crypto");
    const { publicEnquiryContext } = await import("@/server/public-enquiry-policy");
    const createdAt = new Date("2026-10-20T10:00:00.000Z");
    const otherCentreId = randomUUID();
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [otherCentreId, organizationId, `X-${otherCentreId.slice(0, 8)}`, "Synthetic Enquiry Other Centre"]);
    const insertEnquiry = async (targetCentreId: string, status: string, label: string) => {
      const id = randomUUID();
      const encrypted = encryptLeadValue("private-data", { firstName: "Synthetic", lastName: label, organizationName: null, phone: null, email: null, category: "GENERAL", requestTopic: "GENERAL", message: `Private message ${label}`, requestKind: "INQUIRY", requestedService: null, preferredDate: null, preferredTimeWindow: null, visitType: null, collectionAddress: null, responsePermission: false, responsePermissionTextVersion: "PUBLIC_ENQUIRY_RESPONSE_V1", submittedAt: createdAt.toISOString() }, publicEnquiryContext({ organizationId, centreId: targetCentreId, id }));
      await pool.query("INSERT INTO public_enquiries(id,organization_id,centre_id,enquiry_number,status,private_data_ciphertext,idempotency_key,request_fingerprint,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, organizationId, targetCentreId, `ENQ-${id.slice(0, 8)}`, status, encrypted, randomUUID(), "f".repeat(64), createdAt]);
      return id;
    };
    const visibleId = await insertEnquiry(centreId, "PENDING_REVIEW", "Visible");
    await insertEnquiry(otherCentreId, "PENDING_REVIEW", "OtherCentre");
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "leads.read", centreId }] }, response: null });

    const response = await operationsHandler();
    expect(response.status).toBe(200);
    const payload = await response.json() as { centres: Array<{ id: string; metrics: Record<string, number>; queue: Array<{ id: string; kind: string; reference: string; href: string }> }> };
    const centreSummary = payload.centres.find((item) => item.id === centreId)!;
    expect(centreSummary.metrics.pendingWebsiteEnquiries).toBe(1);
    expect(centreSummary.queue).toEqual(expect.arrayContaining([expect.objectContaining({ id: visibleId, kind: "WEBSITE_ENQUIRY", href: `/leads/public-enquiries?enquiryId=${visibleId}&centreId=${centreId}` })]));
    const serialized = JSON.stringify(centreSummary.queue);
    expect(serialized).not.toContain("Visible");
    expect(serialized).not.toContain("Private message");
    expect(serialized).not.toContain("OtherCentre");

    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }] }, response: null });
    const restrictedResponse = await operationsHandler();
    const restrictedPayload = await restrictedResponse.json() as typeof payload;
    const restrictedCentre = restrictedPayload.centres.find((item) => item.id === centreId)!;
    expect(restrictedCentre.metrics).not.toHaveProperty("pendingWebsiteEnquiries");
    expect(restrictedCentre.queue.some((item) => item.kind === "WEBSITE_ENQUIRY")).toBe(false);
  });

  it("shows only overdue report follow-ups in the Centre Operations urgent queue", async () => {
    const created = await handler(request(randomUUID()));
    expect(created.status).toBe(201);
    const booking = await created.json() as { appointment: { id: string } };
    const orderId = randomUUID();
    await pool.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [orderId, organizationId, centreId, `O-${orderId.slice(0, 8)}`, patientId, booking.appointment.id, randomUUID(), "9".repeat(64), staffUserId]);
    const reportId = randomUUID();
    const { encryptFinanceReportPrivateData } = await import("@/server/finance-report-crypto");
    const reportPrivateData = encryptFinanceReportPrivateData("report-private", { externalReference: null, holdReason: null }, { organizationId, centreId, recordId: reportId });
    await pool.query("INSERT INTO diagnostic_reports(id,organization_id,centre_id,patient_id,order_id,report_number,private_data_ciphertext,uploader_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)", [reportId, organizationId, centreId, patientId, orderId, `R-${reportId.slice(0, 8)}`, reportPrivateData, staffUserId]);
    const overdueId = randomUUID();
    const futureId = randomUUID();
    const overduePrivate = encryptFinanceReportPrivateData("report-followup", { outcomeNote: null }, { organizationId, centreId, recordId: overdueId });
    const futurePrivate = encryptFinanceReportPrivateData("report-followup", { outcomeNote: null }, { organizationId, centreId, recordId: futureId });
    await pool.query("INSERT INTO report_followups(id,organization_id,centre_id,report_id,assigned_staff_id,task_type,idempotency_key,due_at,status,created_by_staff_id,private_data_ciphertext) VALUES($1,$2,$3,$4,$5,'REPORT_PENDING',$6,now()-interval '1 hour','SCHEDULED',$5,$7),($8,$2,$3,$4,$5,'REPORT_READY',$9,now()+interval '1 day','SCHEDULED',$5,$10)", [overdueId, organizationId, centreId, reportId, staffUserId, randomUUID(), overduePrivate, futureId, randomUUID(), futurePrivate]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "workspace.read", centreId }, { key: "reports.read", centreId }, { key: "reports.followups.manage", centreId }] }, response: null });

    const reportFollowupsResponse = await reportFollowupsHandler(new Request(`http://localhost/api/report-followups?centreId=${centreId}&followupId=${overdueId}`));
    expect(reportFollowupsResponse.status).toBe(200);
    expect((await reportFollowupsResponse.json() as { followups: Array<{ id: string }> }).followups.map((item) => item.id)).toEqual([overdueId]);
    const unavailableReportFollowupResponse = await reportFollowupsHandler(new Request(`http://localhost/api/report-followups?centreId=${centreId}&followupId=${randomUUID()}`));
    expect((await unavailableReportFollowupResponse.json() as { followups: Array<{ id: string }> }).followups).toEqual([]);

    const response = await operationsHandler();
    expect(response.status).toBe(200);
    const payload = await response.json() as { centres: Array<{ id: string; metrics: Record<string, number>; queue: Array<{ id: string; kind: string }> }> };
    const summary = payload.centres.find((item) => item.id === centreId)!;
    expect(summary.metrics.overdueReportFollowups).toBe(1);
    expect(summary.queue).toContainEqual(expect.objectContaining({ id: overdueId, kind: "REPORT_FOLLOWUP" }));
    expect(summary.queue.some((item) => item.id === futureId)).toBe(false);
  });

  it("shows only open support tasks from a support reader's centre in Centre Operations", async () => {
    const supportCentreId = randomUUID();
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [supportCentreId, organizationId, `SC-${supportCentreId.slice(0, 8)}`, "Synthetic Support Work Centre"]);
    const otherCentreId = randomUUID();
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [otherCentreId, organizationId, `S-${otherCentreId.slice(0, 8)}`, "Synthetic Other Support Centre"]);
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    const records = [
      { centre: supportCentreId, type: "SUPPORT_REQUEST", status: "OPEN" },
      { centre: supportCentreId, type: "SUPPORT_REQUEST", status: "IN_PROGRESS" },
      { centre: supportCentreId, type: "SUPPORT_REQUEST", status: "COMPLETED" },
      { centre: supportCentreId, type: "GENERAL", status: "OPEN" },
      { centre: otherCentreId, type: "SUPPORT_REQUEST", status: "OPEN" },
    ];
    const ids: string[] = [];
    for (const item of records) {
      const id = randomUUID(); ids.push(id);
      const privateData = encryptOperationalData({ title: `Synthetic ${item.type} ${item.status}`, description: "synthetic-private-description-not-for-summary" }, operationalContext({ organizationId, centreId: item.centre, recordId: id }, "staff-task"));
      await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,approval_status,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,'NORMAL',$7,'NOT_REQUIRED',$8,$8,$9,$10)", [id, organizationId, item.centre, `SUP-${id.slice(0, 8)}`, privateData, item.type, item.status, staffUserId, randomUUID(), "s".repeat(64)]);
    }
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [
      { key: "workspace.read", centreId: supportCentreId }, { key: "tasks.support.read", centreId: supportCentreId },
    ] }, response: null });

    const response = await operationsHandler();
    expect(response.status).toBe(200);
    const payload = await response.json() as { centres: Array<{ id: string; metrics: Record<string, number>; queue: Array<{ id: string; kind: string; status: string; href: string }> }> };
    expect(payload.centres).toHaveLength(1);
    const summary = payload.centres[0];
    expect(summary.id).toBe(supportCentreId);
    expect(summary.metrics.openSupportRequests).toBe(2);
    expect(summary.metrics).not.toHaveProperty("openTasks");
    expect(summary.queue).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: ids[0], kind: "SUPPORT_REQUEST", status: "OPEN", href: `/support/tickets/${ids[0]}` }),
      expect.objectContaining({ id: ids[1], kind: "SUPPORT_REQUEST", status: "IN_PROGRESS", href: `/support/tickets/${ids[1]}` }),
    ]));
    expect(summary.queue.some((item) => ids.slice(2).includes(item.id))).toBe(false);
    expect(JSON.stringify(summary)).not.toContain("synthetic-private-description-not-for-summary");
  });

  it("links a website enquiry to a staff task without copying enquiry contact data", async () => {
    const isolatedCentreId = randomUUID();
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [isolatedCentreId, organizationId, `W-${isolatedCentreId.slice(0, 8)}`, "Synthetic Enquiry Task Centre"]);
    const role = await pool.query("SELECT id FROM roles WHERE organization_id=$1 AND key='synthetic_workload'", [organizationId]);
    await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, staffUserId, role.rows[0].id, isolatedCentreId]);
    const { encryptLeadValue } = await import("@/server/lead-crypto");
    const { publicEnquiryContext } = await import("@/server/public-enquiry-policy");
    const enquiryId = randomUUID();
    const privatePayload = { firstName: "Synthetic", lastName: "Support Contact", phone: "+910000000004", email: "task-private-contact@invalid.test", category: "GENERAL", message: "Synthetic support enquiry private body", requestKind: "INQUIRY", requestedService: null, preferredDate: null, preferredTimeWindow: null, visitType: null, collectionAddress: null, responsePermission: true, responsePermissionTextVersion: "PUBLIC_ENQUIRY_RESPONSE_V1", submittedAt: new Date().toISOString() };
    await pool.query("INSERT INTO public_enquiries(id,organization_id,centre_id,enquiry_number,status,private_data_ciphertext,phone_blind_index,email_blind_index,idempotency_key,request_fingerprint) VALUES($1,$2,$3,$4,'PENDING_REVIEW',$5,NULL,NULL,$6,$7)", [enquiryId, organizationId, isolatedCentreId, `RHC-W-SYN-${enquiryId.slice(0, 8)}`, encryptLeadValue("private-data", privatePayload, publicEnquiryContext({ organizationId, centreId: isolatedCentreId, id: enquiryId })), randomUUID(), "c".repeat(64)]);
    const grants = ["tasks.create", "tasks.support.create", "tasks.read", "tasks.update", "workspace.read", "leads.read"].map((key) => ({ key, centreId: isolatedCentreId }));
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => grants.some((grant) => grant.key === permission && (!requestedCentre || grant.centreId === requestedCentre))
      ? { staff: { organizationId, staffUserId, grants }, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const idempotencyKey = randomUUID();
    const taskPayloadJson = JSON.stringify({ centreId: isolatedCentreId, assignedStaffId: staffUserId, title: "Review website enquiry", description: "Review the request and confirm the permitted next step. Do not contact the enquirer until contact permission is verified.", priority: "NORMAL", taskType: "SUPPORT_REQUEST", requiresApproval: false, reference: { type: "PUBLIC_ENQUIRY", id: enquiryId } });
    const taskRequest = () => new Request("http://localhost/api/tasks", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": idempotencyKey }, body: taskPayloadJson });
    const createdResponse = await taskCreateHandler(taskRequest());
    expect(createdResponse.status, JSON.stringify(await createdResponse.clone().json())).toBe(201);
    const created = await createdResponse.json() as { task: { id: string } };
    const replay = await taskCreateHandler(taskRequest());
    expect(replay.status).toBe(200);
    expect(await replay.json()).toMatchObject({ task: { id: created.task.id, replayed: true } });
    const taskCount = await pool.query("SELECT count(*)::int AS count FROM staff_tasks WHERE idempotency_key=$1 AND organization_id=$2 AND centre_id=$3", [idempotencyKey, organizationId, isolatedCentreId]);
    expect(taskCount.rows[0].count).toBe(1);
    const stored = await pool.query("SELECT private_data_ciphertext FROM staff_tasks WHERE id=$1", [created.task.id]);
    expect(stored.rows[0].private_data_ciphertext).not.toContain("task-private-contact@invalid.test");
    const readResponse = await taskReadHandler(new Request(`http://localhost/api/tasks/${created.task.id}`), { params: Promise.resolve({ id: created.task.id }) });
    expect(readResponse.status).toBe(200);
    const taskBody = await readResponse.json() as { task: { reference: { type: string; id: string; label: string } } };
    expect(taskBody.task.reference).toMatchObject({ type: "PUBLIC_ENQUIRY", id: enquiryId });
    expect(taskBody.task.reference.label).toContain("PENDING_REVIEW");
    expect(JSON.stringify(taskBody)).not.toContain("task-private-contact@invalid.test");
    expect(JSON.stringify(taskBody)).not.toContain("Synthetic Support Contact");
  });

  it("keeps finance-linked escalations visible after the payment or refund status advances", async () => {
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    const { encryptFinanceReportPrivateData } = await import("@/server/finance-report-crypto");
    const paymentId = randomUUID();
    const refundId = randomUUID();
    const paymentEscalationId = randomUUID();
    const refundEscalationId = randomUUID();
    const privatePayment = encryptFinanceReportPrivateData("finance-payment", { reference: "SYNTHETIC-ESCALATION-REFERENCE" }, { organizationId, centreId, recordId: paymentId });
    await pool.query("INSERT INTO finance_payments(id,organization_id,centre_id,payment_number,method,status,amount_minor,private_data_ciphertext,received_by_staff_id,idempotency_key) VALUES($1,$2,$3,$4,'UPI','DISPUTED',100,$5,$6,$7)", [paymentId, organizationId, centreId, `PAY-${paymentId.slice(0, 8)}`, privatePayment, staffUserId, randomUUID()]);
    const privateRefund = encryptFinanceReportPrivateData("finance-refund", { reason: "Synthetic refund review", executionReference: null }, { organizationId, centreId, recordId: refundId });
    await pool.query("INSERT INTO finance_refunds(id,organization_id,centre_id,payment_id,amount_minor,status,requested_by_staff_id,private_data_ciphertext) VALUES($1,$2,$3,$4,50,'REQUESTED',$5,$6)", [refundId, organizationId, centreId, paymentId, staffUserId, privateRefund]);
    const insertEscalation = async (id: string, sourceType: "FINANCE_PAYMENT" | "FINANCE_REFUND", sourceId: string) => {
      const encrypted = encryptOperationalData({ title: "Synthetic finance follow-up", description: "Private escalation note" }, operationalContext({ organizationId, centreId, recordId: id }, "staff-escalation"));
      await pool.query("INSERT INTO staff_escalations(id,organization_id,centre_id,escalation_number,source_type,source_id,private_data_ciphertext,severity,priority,status,assigned_owner_staff_id,created_by_staff_id,due_at,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,$7,'MODERATE','NORMAL','OPEN',$8,$8,now()+interval '1 day',$9,$10)", [id, organizationId, centreId, `E-${id.slice(0, 8)}`, sourceType, sourceId, encrypted, staffUserId, randomUUID(), sourceType === "FINANCE_PAYMENT" ? "f".repeat(64) : "a".repeat(64)]);
    };
    await insertEscalation(paymentEscalationId, "FINANCE_PAYMENT", paymentId);
    await insertEscalation(refundEscalationId, "FINANCE_REFUND", refundId);
    await pool.query("UPDATE finance_payments SET status='CONFIRMED',version=version+1 WHERE id=$1", [paymentId]);
    await pool.query("UPDATE finance_refunds SET status='REJECTED' WHERE id=$1", [refundId]);

    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "finance.read", centreId }, { key: "escalations.read", centreId }] }, response: null });
    const response = await escalationListHandler(new Request(`http://localhost/api/escalations?centreId=${centreId}&status=OPEN`));
    expect(response.status).toBe(200);
    const body = await response.json() as { escalations: Array<{ id: string; source: { label: string } }> };
    expect(body.escalations.map((item) => item.id)).toEqual(expect.arrayContaining([paymentEscalationId, refundEscalationId]));
    expect(body.escalations.find((item) => item.id === paymentEscalationId)?.source.label).toBe("Payment · CONFIRMED");
    expect(body.escalations.find((item) => item.id === refundEscalationId)?.source.label).toBe("Refund · REJECTED");
    expect(JSON.stringify(body.escalations)).not.toContain("SYNTHETIC-ESCALATION-REFERENCE");
    expect(JSON.stringify(body.escalations)).not.toContain("Synthetic refund review");
    const { resolveTaskReference } = await import("@/server/task-reference");
    const authorizedStaff = { organizationId, staffUserId, grants: [{ key: "finance.read", centreId }] };
    expect(await resolveTaskReference(authorizedStaff, centreId, { type: "FINANCE_PAYMENT", id: paymentId })).toBe("Payment · CONFIRMED");
    expect(await resolveTaskReference(authorizedStaff, centreId, { type: "FINANCE_REFUND", id: refundId })).toBe("Refund · REJECTED");
    expect(await resolveTaskReference(authorizedStaff, centreId, { type: "FINANCE_PAYMENT", id: paymentId }, { forEscalationCreation: true })).toBeNull();
    expect(await resolveTaskReference(authorizedStaff, centreId, { type: "FINANCE_REFUND", id: refundId }, { forEscalationCreation: true })).toBeNull();

    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentreId?: string) => {
      if (requestedCentreId && requestedCentreId !== centreId) return { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) };
      if (permission === "escalations.read") return { staff: { organizationId, staffUserId, grants: [{ key: "escalations.read", centreId }] }, response: null };
      return { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) };
    });
    const withoutFinancePermission = await escalationListHandler(new Request(`http://localhost/api/escalations?centreId=${centreId}&status=OPEN`));
    expect((await withoutFinancePermission.json() as { escalations: unknown[] }).escalations).toHaveLength(0);
    const crossCentre = await escalationListHandler(new Request(`http://localhost/api/escalations?centreId=${randomUUID()}&status=OPEN`));
    expect(crossCentre.status).toBe(403);
  });

  it("creates, edits, records referral activity, and replays encrypted doctor relationship changes", async () => {
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ synthetic_test_key: Buffer.alloc(32, 9).toString("base64") });
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "synthetic_test_key";
    const grants = [{ key: "doctors.read", centreId }, { key: "doctors.manage", centreId }, { key: "leads.create", centreId }, { key: "leads.read", centreId }, { key: "leads.update", centreId }, { key: "appointments.read", centreId }, { key: "tasks.create", centreId }, { key: "tasks.read", centreId }, { key: "workspace.read", centreId }];
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => {
      if (requestedCentre && requestedCentre !== centreId) return { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) };
      return grants.some((grant) => grant.key === permission) ? { staff: { organizationId, staffUserId, grants }, response: null } : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) };
    });
    const createKey = randomUUID();
    const paginatedSpecialty = `Synthetic specialty ${randomUUID()}`;
    const createBody = { centreId, name: "Synthetic Doctor", specialty: paginatedSpecialty, phone: "+910000000099", email: "doctor@synthetic.invalid", registrationReference: "SYNTH-REG-01", affiliation: "Synthetic clinic", notes: "Private synthetic relationship note" };
    const createRequest = () => new Request("http://localhost/api/doctors", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": createKey }, body: JSON.stringify(createBody) });
    const createdResponse = await doctorCreateHandler(createRequest());
    expect(createdResponse.status, JSON.stringify(await createdResponse.clone().json())).toBe(201);
    const created = await createdResponse.json() as { doctor: { id: string; version: number; name: string } };
    expect(created.doctor.name).toBe("Synthetic Doctor");
    const replayResponse = await doctorCreateHandler(createRequest());
    expect(replayResponse.status).toBe(200);
    expect(await replayResponse.json()).toMatchObject({ doctor: { id: created.doctor.id }, replayed: true });
    const privateRetry = await doctorCreateHandler(new Request("http://localhost/api/doctors", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": createKey }, body: JSON.stringify({ ...createBody, name: "Different private name" }) }));
    expect(privateRetry.status).toBe(409);
    const stored = await pool.query("SELECT d.private_data_ciphertext,e.request_hash FROM doctor_profiles d JOIN doctor_relationship_events e ON e.doctor_id=d.id AND e.event_type='CREATED' WHERE d.id=$1 AND d.organization_id=$2 AND d.centre_id=$3", [created.doctor.id, organizationId, centreId]);
    expect(stored.rowCount).toBe(1);
    expect(stored.rows[0].private_data_ciphertext).not.toContain("Synthetic Doctor");
    expect(stored.rows[0].request_hash).not.toBe(createHash("sha256").update(JSON.stringify({ ...createBody, email: "doctor@synthetic.invalid" })).digest("hex"));
    const leadCreate = await leadCreateHandler(new Request("http://localhost/api/leads", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ centreId, firstName: "Synthetic", lastName: "Doctor Referral", phone: "+910000000121", enquiryCategory: "GENERAL", source: "REFERRAL", sourceDoctorId: created.doctor.id }) }));
    expect(leadCreate.status, JSON.stringify(await leadCreate.clone().json())).toBe(201);
    const createdLead = await leadCreate.json() as { lead: { id: string; leadNumber: string } };
    const attributed = await pool.query("SELECT source,source_doctor_id,source_relationship_id FROM leads WHERE id=$1 AND organization_id=$2 AND centre_id=$3", [createdLead.lead.id, organizationId, centreId]);
    expect(attributed.rows[0]).toEqual({ source: "REFERRAL", source_doctor_id: created.doctor.id, source_relationship_id: null });
    const doctorReferralAppointmentId = randomUUID();
    await pool.query("INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,lead_id,booking_source,visit_type,scheduled_at,duration_minutes,time_zone,status,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,'CRM_LEAD','CENTRE','2099-01-10T09:00:00Z',30,'Asia/Kolkata','REQUESTED','synthetic-empty-private-payload',$7,$8,$9)", [doctorReferralAppointmentId, organizationId, centreId, `RHC-A-${doctorReferralAppointmentId.slice(0, 8).toUpperCase()}`, patientId, createdLead.lead.id, staffUserId, randomUUID(), "b".repeat(64)]);
    const sourceChange = await leadUpdateHandler(new Request(`http://localhost/api/leads/${createdLead.lead.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ source: "PHONE" }) }), { params: Promise.resolve({ id: createdLead.lead.id }) });
    expect(sourceChange.status).toBe(409);
    expect(await sourceChange.json()).toEqual({ error: "source_attribution_locked" });
    const extraDoctorLeadIds = Array.from({ length: 51 }, () => randomUUID());
    const extraDoctorLeadNumbers = extraDoctorLeadIds.map((id) => `SYN-${id.slice(0, 12).toUpperCase()}`);
    await pool.query(`INSERT INTO leads(id,organization_id,centre_id,lead_number,enquiry_category,source,source_doctor_id,assigned_staff_id,created_by_staff_id)
      SELECT seeded.id,$1,$2,seeded.number,'GENERAL','REFERRAL',$3,$4,$4 FROM unnest($5::uuid[],$6::text[]) AS seeded(id,number)`, [organizationId, centreId, created.doctor.id, staffUserId, extraDoctorLeadIds, extraDoctorLeadNumbers]);
    const referredLeadList = await doctorLeadsHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/leads?centreId=${centreId}&page=1&appointmentPage=1`), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(referredLeadList.status).toBe(200);
    const referredData = await referredLeadList.json() as { leads: Array<{ id: string; leadNumber: string }>; appointments: Array<Record<string, unknown>>; appointmentPage: number; appointmentPageSize: number; appointmentsHaveMore: boolean; page: number; pageSize: number; hasMore: boolean; privacy: string };
    expect(referredData).toMatchObject({ page: 1, pageSize: 50, hasMore: true, privacy: "CONTACT_DETAILS_OMITTED" });
    expect(referredData).toMatchObject({ appointmentPage: 1, appointmentPageSize: 25, appointmentsHaveMore: false });
    expect(referredData.appointments).toEqual([expect.objectContaining({ id: doctorReferralAppointmentId, leadNumber: createdLead.lead.leadNumber, status: "REQUESTED", visitType: "CENTRE" })]);
    expect(JSON.stringify(referredData.appointments)).not.toContain(patientId);
    expect(referredData.leads).toHaveLength(50);
    expect(referredData.leads[0]).toEqual(expect.objectContaining({ id: createdLead.lead.id, leadNumber: createdLead.lead.leadNumber }));
    const referredLeadPage2 = await doctorLeadsHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/leads?centreId=${centreId}&page=2`), { params: Promise.resolve({ id: created.doctor.id }) });
    const referredDataPage2 = await referredLeadPage2.json() as { leads: Array<{ id: string }>; page: number; pageSize: number; hasMore: boolean };
    expect(referredDataPage2).toMatchObject({ page: 2, pageSize: 50, hasMore: false });
    expect(referredDataPage2.leads).toHaveLength(2);
    expect(referredData.leads.map((lead) => lead.id)).not.toContain(referredDataPage2.leads[0].id);
    expect(referredData.privacy).toBe("CONTACT_DETAILS_OMITTED");
    expect(JSON.stringify(referredData)).not.toContain("Doctor Referral");
    mocks.getApiAccess.mockResolvedValueOnce({ staff: { organizationId, staffUserId, grants: [{ key: "doctors.read", centreId }] }, response: null }).mockResolvedValueOnce({ staff: { organizationId, staffUserId, grants: [{ key: "leads.read", centreId }] }, response: null }).mockResolvedValueOnce({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const appointmentRestricted = await doctorLeadsHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/leads?centreId=${centreId}`), { params: Promise.resolve({ id: created.doctor.id }) });
    const appointmentRestrictedBody = await appointmentRestricted.json() as Record<string, unknown>;
    expect(appointmentRestricted.status).toBe(200);
    expect(appointmentRestrictedBody).not.toHaveProperty("appointments");
    const attributionDirectory = await doctorDirectoryHandler(new Request(`http://localhost/api/doctors?centreId=${centreId}&status=ACTIVE&purpose=ATTRIBUTION`));
    const attributionRows = await attributionDirectory.json() as { doctors: Array<Record<string, unknown>> };
    expect(attributionRows.doctors.find((row) => row.id === created.doctor.id)).toEqual({ id: created.doctor.id, centreId, doctorNumber: expect.any(String), specialty: paginatedSpecialty, status: "ACTIVE" });
    expect(attributionRows.doctors.find((row) => row.id === created.doctor.id)).not.toHaveProperty("phone");
    const pickerDoctorIds = Array.from({ length: 51 }, () => randomUUID());
    const pickerDoctorNumbers = pickerDoctorIds.map((id) => `RHC-D-2026-SYN${id.slice(0, 8).toUpperCase()}`);
    const pickerDoctorCiphertexts = pickerDoctorIds.map((id, index) => sealDoctorData({ organizationId, centreId, id }, { name: `Synthetic picker doctor ${index}`, phone: null, email: null, registrationReference: null, affiliation: null, notes: null }));
    await pool.query(`INSERT INTO doctor_profiles(id,organization_id,centre_id,doctor_number,specialty,status,private_data_ciphertext,created_by_staff_id,updated_by_staff_id)
      SELECT seeded.id,$1,$2,seeded.number,'Synthetic attribution picker','ACTIVE',seeded.cipher,$3,$3 FROM unnest($4::uuid[],$5::text[],$6::text[]) AS seeded(id,number,cipher)`, [organizationId, centreId, staffUserId, pickerDoctorIds, pickerDoctorNumbers, pickerDoctorCiphertexts]);
    const pickerDoctorsPage1 = await doctorDirectoryHandler(new Request(`http://localhost/api/doctors?centreId=${centreId}&status=ACTIVE&purpose=ATTRIBUTION&page=1&pageSize=50`));
    const pickerDoctorsBody1 = await pickerDoctorsPage1.json() as { doctors: Array<{ id: string; doctorNumber: string; specialty: string }>; page: number; pageSize: number; hasMore: boolean };
    expect(pickerDoctorsBody1).toMatchObject({ page: 1, pageSize: 50, hasMore: true });
    expect(pickerDoctorsBody1.doctors).toHaveLength(50);
    const pickerDoctorsPage2 = await doctorDirectoryHandler(new Request(`http://localhost/api/doctors?centreId=${centreId}&status=ACTIVE&purpose=ATTRIBUTION&page=2&pageSize=50`));
    const pickerDoctorsBody2 = await pickerDoctorsPage2.json() as { doctors: Array<{ id: string; doctorNumber: string; specialty: string }>; page: number; pageSize: number; hasMore: boolean };
    expect(pickerDoctorsBody2).toMatchObject({ page: 2, pageSize: 50, hasMore: false });
    const expectedPickerDoctorCount = Number((await pool.query("SELECT count(*) FROM doctor_profiles WHERE organization_id=$1 AND centre_id=$2 AND status='ACTIVE'", [organizationId, centreId])).rows[0].count);
    expect(pickerDoctorsBody2.doctors).toHaveLength(expectedPickerDoctorCount - 50);
    expect(new Set([...pickerDoctorsBody1.doctors, ...pickerDoctorsBody2.doctors].map((row) => row.id)).size).toBe(expectedPickerDoctorCount);
    expect(JSON.stringify([...pickerDoctorsBody1.doctors, ...pickerDoctorsBody2.doctors])).not.toContain("Synthetic Doctor Updated");
    const updateKey = randomUUID();
    const updateBody = { centreId, expectedVersion: 1, name: "Synthetic Doctor Updated", specialty: paginatedSpecialty, phone: "+910000000099", email: "doctor@synthetic.invalid", registrationReference: "SYNTH-REG-01", affiliation: "Synthetic clinic", notes: "Private synthetic relationship note", status: "ACTIVE" };
    const updateRequest = () => new Request(`http://localhost/api/doctors/${created.doctor.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": updateKey }, body: JSON.stringify(updateBody) });
    expect((await doctorUpdateHandler(updateRequest(), { params: Promise.resolve({ id: created.doctor.id }) })).status).toBe(200);
    expect((await doctorUpdateHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": updateKey }, body: JSON.stringify({ ...updateBody, notes: "Changed private retry note" }) }), { params: Promise.resolve({ id: created.doctor.id }) })).status).toBe(409);
    const updateEventHash = await pool.query("SELECT request_hash FROM doctor_relationship_events WHERE idempotency_key=$1", [updateKey]);
    expect(updateEventHash.rows[0].request_hash).not.toBe(createHash("sha256").update(JSON.stringify(updateBody)).digest("hex"));
    const stale = await doctorUpdateHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(updateBody) }), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(stale.status).toBe(409);
    const referralKey = randomUUID();
    const referralRequest = () => new Request(`http://localhost/api/doctors/${created.doctor.id}/referrals`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": referralKey }, body: JSON.stringify({ centreId, category: "TEST_ENQUIRY", serviceReference: "SYNTH-PANEL", note: "Synthetic referral context" }) });
    expect((await doctorReferralHandler(referralRequest(), { params: Promise.resolve({ id: created.doctor.id }) })).status).toBe(201);
    expect((await doctorReferralHandler(referralRequest(), { params: Promise.resolve({ id: created.doctor.id }) })).status).toBe(200);
    const referralRetry = await doctorReferralHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/referrals`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": referralKey }, body: JSON.stringify({ centreId, category: "TEST_ENQUIRY", serviceReference: "SYNTH-PANEL", note: "Changed private referral note" }) }), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(referralRetry.status).toBe(409);
    const referralEventHash = await pool.query("SELECT request_hash FROM doctor_relationship_events WHERE idempotency_key=$1", [referralKey]);
    expect(referralEventHash.rows[0].request_hash).not.toBe(createHash("sha256").update(JSON.stringify({ centreId, category: "TEST_ENQUIRY", serviceReference: "SYNTH-PANEL", note: "Synthetic referral context" })).digest("hex"));
    const doctorTaskKey = randomUUID();
    const doctorTaskBody = { centreId, assignedStaffId: staffUserId, title: "Synthetic doctor relationship follow-up", description: "Discuss the approved service information at a later visit.", reference: { type: "DOCTOR_RELATIONSHIP", id: created.doctor.id }, taskType: "FOLLOW_UP", priority: "NORMAL", dueAt: null, requiresApproval: false };
    const doctorTaskRequest = () => new Request("http://localhost/api/tasks", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": doctorTaskKey }, body: JSON.stringify(doctorTaskBody) });
    const doctorTaskResponse = await taskCreateHandler(doctorTaskRequest());
    expect(doctorTaskResponse.status, JSON.stringify(await doctorTaskResponse.clone().json())).toBe(201);
    const doctorTask = await doctorTaskResponse.json() as { task: { id: string; taskNumber: string } };
    expect((await taskCreateHandler(doctorTaskRequest())).status).toBe(200);
    const doctorTaskRead = await taskReadHandler(new Request(`http://localhost/api/tasks/${doctorTask.task.id}`), { params: Promise.resolve({ id: doctorTask.task.id }) });
    expect(doctorTaskRead.status).toBe(200);
    expect(await doctorTaskRead.json()).toMatchObject({ task: { title: doctorTaskBody.title, reference: { type: "DOCTOR_RELATIONSHIP", id: created.doctor.id } } });
    const doctorTaskStored = await pool.query("SELECT private_data_ciphertext FROM staff_tasks WHERE id=$1 AND organization_id=$2 AND centre_id=$3", [doctorTask.task.id, organizationId, centreId]);
    expect(doctorTaskStored.rows).toHaveLength(1);
    expect(doctorTaskStored.rows[0].private_data_ciphertext).not.toContain("Synthetic doctor relationship follow-up");
    const doctorReferences = await taskReferencesHandler(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=DOCTOR_RELATIONSHIP`));
    expect(doctorReferences.status).toBe(200);
    expect((await doctorReferences.json() as { references: Array<{ id: string }> }).references).toContainEqual(expect.objectContaining({ id: created.doctor.id }));
    const read = await doctorReadHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}?centreId=${centreId}`), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(read.status).toBe(200);
    const detail = await read.json() as { doctor: { name: string; version: number }; history: Array<{ type: string; note?: string; serviceReference?: string }> };
    expect(detail.doctor).toMatchObject({ name: "Synthetic Doctor Updated", version: 2 });
    expect(detail.history).toEqual(expect.arrayContaining([expect.objectContaining({ type: "REFERRAL_RECORDED", note: "Synthetic referral context", serviceReference: "SYNTH-PANEL" })]));
    const planKey = randomUUID();
    const visitPlan = { action: "PLAN", centreId, scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), purpose: "RELATIONSHIP", agenda: "Synthetic service overview" };
    const planRequest = () => new Request(`http://localhost/api/doctors/${created.doctor.id}/visits`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": planKey }, body: JSON.stringify(visitPlan) });
    const plannedResponse = await doctorVisitHandler(planRequest(), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(plannedResponse.status, JSON.stringify(await plannedResponse.clone().json())).toBe(201);
    const planned = await plannedResponse.json() as { visitEvent: { id: string; visitId: string; type: string } };
    expect(planned.visitEvent.type).toBe("VISIT_PLANNED");
    expect((await doctorVisitHandler(planRequest(), { params: Promise.resolve({ id: created.doctor.id }) })).status).toBe(200);
    const pastPlan = await doctorVisitHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/visits`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ ...visitPlan, scheduledAt: new Date(Date.now() - 60_000).toISOString() }) }), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(pastPlan.status).toBe(400);
    const notCheckedIn = await doctorVisitHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/visits`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "RECORD", centreId, visitId: planned.visitEvent.visitId, summary: "Synthetic relationship meeting" }) }), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(notCheckedIn.status).toBe(409);
    const checkInKey = randomUUID();
    const checkInBody = { action: "CHECK_IN", centreId, visitId: planned.visitEvent.visitId };
    const checkIn = await doctorVisitHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/visits`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": checkInKey }, body: JSON.stringify(checkInBody) }), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(checkIn.status).toBe(201);
    const checkInReplay = await doctorVisitHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/visits`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": checkInKey }, body: JSON.stringify(checkInBody) }), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(checkInReplay.status).toBe(200);
    const duplicateCheckIn = await doctorVisitHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/visits`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(checkInBody) }), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(duplicateCheckIn.status).toBe(409);
    const recordBeforeCheckIn = await doctorVisitHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/visits`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "RECORD", centreId, visitId: planned.visitEvent.id, summary: "Synthetic relationship meeting" }) }), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(recordBeforeCheckIn.status).toBe(404);
    const recordKey = randomUUID();
    const recordBody = { action: "RECORD", centreId, visitId: planned.visitEvent.visitId, summary: "Synthetic relationship meeting", followUp: "Share approved service brochure" };
    const recorded = await doctorVisitHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/visits`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": recordKey }, body: JSON.stringify(recordBody) }), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(recorded.status).toBe(201);
    const cancelledAfterCheckIn = await doctorVisitHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/visits`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "CANCEL", centreId, visitId: planned.visitEvent.visitId, reason: "Synthetic cancellation" }) }), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(cancelledAfterCheckIn.status).toBe(409);
    const closedReplay = await doctorVisitHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/visits`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(recordBody) }), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(closedReplay.status).toBe(409);
    const cancelPlanKey = randomUUID();
    const cancelPlanResponse = await doctorVisitHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/visits`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": cancelPlanKey }, body: JSON.stringify({ ...visitPlan, scheduledAt: new Date(Date.now() + 172_800_000).toISOString(), agenda: "Synthetic cancellable plan" }) }), { params: Promise.resolve({ id: created.doctor.id }) });
    const cancelPlan = await cancelPlanResponse.json() as { visitEvent: { visitId: string } };
    expect(cancelPlanResponse.status).toBe(201);
    const cancelled = await doctorVisitHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/visits`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "CANCEL", centreId, visitId: cancelPlan.visitEvent.visitId, reason: "Synthetic schedule change" }) }), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(cancelled.status).toBe(201);
    const deniedVisitMutation = await doctorVisitHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/visits`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "PLAN", centreId: randomUUID(), scheduledAt: new Date(Date.now() + 86_400_000).toISOString(), purpose: "OTHER" }) }), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(deniedVisitMutation.status).toBe(403);
    const visitDetail = await doctorReadHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}?centreId=${centreId}`), { params: Promise.resolve({ id: created.doctor.id }) });
    const visitHistory = await visitDetail.json() as { history: Array<{ type: string; visitId?: string; summary?: string; followUp?: string }> };
    expect(visitHistory.history).toEqual(expect.arrayContaining([expect.objectContaining({ type: "VISIT_PLANNED", visitId: planned.visitEvent.visitId }), expect.objectContaining({ type: "VISIT_CHECKED_IN", visitId: planned.visitEvent.visitId }), expect.objectContaining({ type: "VISIT_RECORDED", visitId: planned.visitEvent.visitId, summary: "Synthetic relationship meeting", followUp: "Share approved service brochure" }), expect.objectContaining({ type: "VISIT_CANCELLED", visitId: cancelPlan.visitEvent.visitId, reason: "Synthetic schedule change" })]));
    const visitList = await doctorVisitListHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/visits?centreId=${centreId}`), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(visitList.status).toBe(200);
    expect(visitList.headers.get("cache-control")).toContain("no-store");
    const visitRows = await visitList.json() as { visits: Array<{ id: string; summary: string | null; events: Array<{ type: string }> }> };
    expect(visitRows.visits).toEqual(expect.arrayContaining([expect.objectContaining({ id: planned.visitEvent.visitId, summary: "Synthetic relationship meeting", events: expect.arrayContaining([expect.objectContaining({ type: "VISIT_PLANNED" }), expect.objectContaining({ type: "VISIT_CHECKED_IN" }), expect.objectContaining({ type: "VISIT_RECORDED" })]) })]));
    const crossCentreVisitList = await doctorVisitListHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/visits?centreId=${randomUUID()}`), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(crossCentreVisitList.status).toBe(403);
    const planStored = await pool.query("SELECT event_type,private_data_ciphertext FROM doctor_relationship_events WHERE id=$1", [planned.visitEvent.id]);
    expect(planStored.rows[0].event_type).toBe("VISIT_PLANNED");
    expect(planStored.rows[0].private_data_ciphertext).not.toContain("Synthetic service overview");
    const visitCiphertexts = await pool.query("SELECT private_data_ciphertext FROM doctor_relationship_events WHERE doctor_id=$1 AND event_type IN ('VISIT_PLANNED','VISIT_CHECKED_IN','VISIT_RECORDED','VISIT_CANCELLED')", [created.doctor.id]);
    expect(JSON.stringify(visitCiphertexts.rows)).not.toContain("Synthetic relationship meeting");
    expect(JSON.stringify(visitCiphertexts.rows)).not.toContain("Share approved service brochure");
    await pool.query("INSERT INTO lead_conversions(id,organization_id,centre_id,lead_id,patient_id,conversion_mode,converted_by_staff_id) VALUES($1,$2,$3,$4,$5,'NEW',$6)", [randomUUID(), organizationId, centreId, createdLead.lead.id, patientId, staffUserId]);
    const directory = await doctorDirectoryHandler(new Request(`http://localhost/api/doctors?centreId=${centreId}&specialty=${encodeURIComponent(paginatedSpecialty)}&pageSize=50`));
    const directoryBody = await directory.json() as { doctors?: Array<{ id: string; attribution?: { leads: number; converted: number } }>; error?: string };
    expect(directory.status, JSON.stringify(directoryBody)).toBe(200);
    expect(directoryBody.doctors?.map((row) => row.id)).toContain(created.doctor.id);
    expect(directoryBody.doctors?.find((row) => row.id === created.doctor.id)?.attribution).toEqual({ leads: 52, converted: 1 });
    const boundedDirectory = await doctorDirectoryHandler(new Request(`http://localhost/api/doctors?centreId=${centreId}&specialty=${encodeURIComponent(paginatedSpecialty)}&pageSize=50&attributionFrom=2099-01-01&attributionTo=2099-01-31`));
    const boundedDirectoryBody = await boundedDirectory.json() as { doctors?: Array<{ id: string; attribution?: { leads: number; converted: number } }> };
    expect(boundedDirectory.status).toBe(200);
    expect(boundedDirectoryBody.doctors?.find((row) => row.id === created.doctor.id)?.attribution).toEqual({ leads: 0, converted: 0 });
    const incompleteAttributionRange = await doctorDirectoryHandler(new Request(`http://localhost/api/doctors?centreId=${centreId}&attributionFrom=2099-01-01`));
    expect(incompleteAttributionRange.status).toBe(400);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "doctors.read", centreId }] }, response: null });
    const restrictedDoctorDirectory = await doctorDirectoryHandler(new Request(`http://localhost/api/doctors?centreId=${centreId}&specialty=${encodeURIComponent(paginatedSpecialty)}&pageSize=50`));
    const restrictedDoctorData = await restrictedDoctorDirectory.json() as { doctors: Array<{ id: string; attribution?: unknown }> };
    expect(restrictedDoctorData.doctors.find((row) => row.id === created.doctor.id)).not.toHaveProperty("attribution");
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => {
      if (requestedCentre && requestedCentre !== centreId) return { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) };
      return grants.some((grant) => grant.key === permission) ? { staff: { organizationId, staffUserId, grants }, response: null } : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) };
    });
    const secondPagedDoctorId = randomUUID();
    const secondPagedDoctorNumber = `RHC-D-${secondPagedDoctorId.slice(0, 8)}`;
    const secondPagedDoctorCiphertext = sealDoctorData({ organizationId, centreId, id: secondPagedDoctorId }, { name: "Synthetic Pagination Doctor", phone: null, email: null, registrationReference: null, affiliation: null, notes: null });
    await pool.query("INSERT INTO doctor_profiles(id,organization_id,centre_id,doctor_number,specialty,status,private_data_ciphertext,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6,$7,$7)", [secondPagedDoctorId, organizationId, centreId, secondPagedDoctorNumber, paginatedSpecialty, secondPagedDoctorCiphertext, staffUserId]);
    const firstDoctorPage = await doctorDirectoryHandler(new Request(`http://localhost/api/doctors?centreId=${centreId}&page=1&pageSize=1&specialty=${encodeURIComponent(paginatedSpecialty)}`));
    const firstDoctorPageBody = await firstDoctorPage.json() as { doctors: Array<{ id: string }>; page: number; pageSize: number; hasMore: boolean };
    expect(firstDoctorPageBody).toMatchObject({ page: 1, pageSize: 1, hasMore: true });
    expect(firstDoctorPageBody.doctors).toHaveLength(1);
    const secondDoctorPage = await doctorDirectoryHandler(new Request(`http://localhost/api/doctors?centreId=${centreId}&page=2&pageSize=1&specialty=${encodeURIComponent(paginatedSpecialty)}`));
    const secondDoctorPageBody = await secondDoctorPage.json() as { doctors: Array<{ id: string }>; page: number; pageSize: number; hasMore: boolean };
    expect(secondDoctorPageBody).toMatchObject({ page: 2, pageSize: 1, hasMore: false });
    expect(secondDoctorPageBody.doctors).toHaveLength(1);
    expect(secondDoctorPageBody.doctors[0].id).not.toBe(firstDoctorPageBody.doctors[0].id);
    const crossCentre = await doctorReadHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}?centreId=${randomUUID()}`), { params: Promise.resolve({ id: created.doctor.id }) });
    expect(crossCentre.status).toBe(403);
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => {
      if (requestedCentre && requestedCentre !== centreId) return { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) };
      const restricted = grants.filter((grant) => grant.key !== "leads.read");
      return restricted.some((grant) => grant.key === permission) ? { staff: { organizationId, staffUserId, grants: restricted }, response: null } : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) };
    });
    expect((await doctorLeadsHandler(new Request(`http://localhost/api/doctors/${created.doctor.id}/leads?centreId=${centreId}`), { params: Promise.resolve({ id: created.doctor.id }) })).status).toBe(403);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }, { key: "appointments.update", centreId }, { key: "appointments.assign", centreId }, { key: "roster.read", centreId }, { key: "finance.read", centreId }] }, response: null });
  });

  it("creates and manages encrypted corporate/partner relationships with centre isolation and immutable activity", async () => {
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ synthetic_test_key: Buffer.alloc(32, 9).toString("base64") });
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "synthetic_test_key";
    const convertedPatientId = randomUUID();
    await pool.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,consent_recorded_at,consent_method,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',NULL,NULL,$5)", [convertedPatientId, organizationId, centreId, `P-${convertedPatientId.slice(0, 8)}`, staffUserId]);
    const { encryptPatientContacts, encryptPatientIdentity } = await import("@/server/patient-contact-crypto");
    const patientContext = { organizationId, centreId, patientId: convertedPatientId };
    const convertedIdentity = encryptPatientIdentity({ firstName: "Synthetic", lastName: "Corporate Conversion" }, patientContext);
    const convertedContacts = encryptPatientContacts({ phone: "+910000000097", email: null, profile: { dateOfBirth: "1990-01-01", sexAtRegistration: null, address: null, preferredName: null } }, patientContext);
    await pool.query("INSERT INTO patient_contact_secrets(patient_id,organization_id,centre_id,encryption_key_id,phone_ciphertext,email_ciphertext,profile_ciphertext,name_ciphertext,phone_blind_index,email_blind_index,first_name_blind_index,last_name_blind_index,full_name_blind_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)", [convertedPatientId, organizationId, centreId, convertedContacts.encryptionKeyId, convertedContacts.phoneCiphertext, convertedContacts.emailCiphertext, convertedContacts.profileCiphertext, convertedIdentity.nameCiphertext, convertedContacts.phoneBlindIndex, convertedContacts.emailBlindIndex, convertedIdentity.firstNameBlindIndex, convertedIdentity.lastNameBlindIndex, convertedIdentity.fullNameBlindIndex]);
    const grants = [{ key: "corporate.read", centreId }, { key: "corporate.manage", centreId }, { key: "leads.create", centreId }, { key: "leads.read", centreId }];
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => (!requestedCentre || requestedCentre === centreId) && grants.some((grant) => grant.key === permission)
      ? { staff: { organizationId, staffUserId, grants }, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const authorizedCentres = await businessRelationshipCentresHandler(new Request("http://localhost/api/business-relationships/centres?type=CORPORATE"));
    expect(authorizedCentres.status).toBe(200);
    expect((await authorizedCentres.json() as { centres: Array<{ id: string }> }).centres.map((row) => row.id)).toEqual([centreId]);
    const createKey = randomUUID();
    const category = `SYNTH-${randomUUID().slice(0, 8)}`;
    const createBody = { centreId, type: "CORPORATE", category, privateData: { name: "Synthetic Works Ltd", legalName: "Synthetic Works Legal", primaryContactName: "Synthetic Contact", primaryContactRole: "HR", phone: "+910000000088", email: "corp-contact@synthetic.invalid", address: "Synthetic address only", agreementReference: "SYNTH-AGREEMENT", agreementStatus: "PENDING_REVIEW", notes: "Private synthetic business note" } };
    const createRequest = () => new Request("http://localhost/api/business-relationships", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": createKey }, body: JSON.stringify(createBody) });
    const createdResponse = await businessRelationshipCreateHandler(createRequest());
    expect(createdResponse.status, JSON.stringify(await createdResponse.clone().json())).toBe(201);
    const created = await createdResponse.json() as { relationship: { id: string; version: number; name: string } };
    expect(created.relationship.name).toBe("Synthetic Works Ltd");
    expect(await businessRelationshipCreateHandler(createRequest()).then((response) => response.status)).toBe(200);
    const changedCreateReplay = await businessRelationshipCreateHandler(new Request("http://localhost/api/business-relationships", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": createKey }, body: JSON.stringify({ ...createBody, privateData: { ...createBody.privateData, name: "Different Synthetic Company" } }) }));
    expect(changedCreateReplay.status).toBe(409);
    const stored = await pool.query("SELECT private_data_ciphertext FROM business_relationships WHERE id=$1 AND organization_id=$2 AND centre_id=$3", [created.relationship.id, organizationId, centreId]);
    expect(stored.rowCount).toBe(1);
    expect(stored.rows[0].private_data_ciphertext).not.toContain("Synthetic Works Ltd");
    expect(stored.rows[0].private_data_ciphertext).not.toContain("corp-contact@synthetic.invalid");
    const leadBody = { centreId, firstName: "Synthetic", lastName: "Referral", phone: "+910000000077", email: "referral@synthetic.invalid", enquiryCategory: "GENERAL", source: "CORPORATE", sourceRelationshipId: created.relationship.id };
    const leadResponse = await leadCreateHandler(new Request("http://localhost/api/leads", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(leadBody) }));
    expect(leadResponse.status, JSON.stringify(await leadResponse.clone().json())).toBe(201);
    const linkedLead = await leadResponse.json() as { lead: { id: string; leadNumber: string } };
    const leadLinkRow = await pool.query("SELECT source, source_relationship_id, source_relationship_type FROM leads WHERE id=$1 AND organization_id=$2 AND centre_id=$3", [linkedLead.lead.id, organizationId, centreId]);
    expect(leadLinkRow.rows[0]).toEqual({ source: "CORPORATE", source_relationship_id: created.relationship.id, source_relationship_type: "CORPORATE" });
    const extraCorporateLeadIds = Array.from({ length: 51 }, () => randomUUID());
    const extraCorporateLeadNumbers = extraCorporateLeadIds.map((id) => `SYN-${id.slice(0, 12).toUpperCase()}`);
    await pool.query(`INSERT INTO leads(id,organization_id,centre_id,lead_number,enquiry_category,source,source_relationship_id,source_relationship_type,assigned_staff_id,created_by_staff_id)
      SELECT seeded.id,$1,$2,seeded.number,'GENERAL','CORPORATE',$3,'CORPORATE',$4,$4 FROM unnest($5::uuid[],$6::text[]) AS seeded(id,number)`, [organizationId, centreId, created.relationship.id, staffUserId, extraCorporateLeadIds, extraCorporateLeadNumbers]);
    const conversionId = randomUUID();
    await pool.query("INSERT INTO lead_conversions(id,organization_id,centre_id,lead_id,patient_id,conversion_mode,converted_by_staff_id) VALUES($1,$2,$3,$4,$5,'NEW',$6)", [conversionId, organizationId, centreId, linkedLead.lead.id, convertedPatientId, staffUserId]);
    const bookingGrants = [{ key: "leads.read", centreId }, { key: "patients.read", centreId }, { key: "appointments.create", centreId }];
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: bookingGrants }, response: null });
    const leadDetail = await leadReadHandler(new Request(`http://localhost/api/leads/${linkedLead.lead.id}`), { params: Promise.resolve({ id: linkedLead.lead.id }) });
    expect(leadDetail.status).toBe(200);
    const leadDetailBody = await leadDetail.json() as { conversion: { patientId: string | null }; capabilities: { patientRead: boolean; appointmentCreate: boolean } };
    expect(leadDetailBody.conversion.patientId).toBe(convertedPatientId);
    expect(leadDetailBody.capabilities).toMatchObject({ patientRead: true, appointmentCreate: true });
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => (!requestedCentre || requestedCentre === centreId) && grants.some((grant) => grant.key === permission)
      ? { staff: { organizationId, staffUserId, grants }, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const directoryResponse = await businessRelationshipListHandler(new Request(`http://localhost/api/business-relationships?centreId=${centreId}&type=CORPORATE&category=${category}`));
    const directoryData = await directoryResponse.json() as { relationships: Array<{ id: string; attribution?: { leads: number; converted: number } }> };
    expect(directoryResponse.status).toBe(200);
    expect(directoryData.relationships).toEqual([expect.objectContaining({ id: created.relationship.id, attribution: { leads: 52, converted: 1 } })]);
    const boundedRelationships = await businessRelationshipListHandler(new Request(`http://localhost/api/business-relationships?centreId=${centreId}&type=CORPORATE&category=${category}&attributionFrom=2099-01-01&attributionTo=2099-01-31`));
    const boundedRelationshipsBody = await boundedRelationships.json() as { relationships?: Array<{ id: string; attribution?: { leads: number; converted: number } }> };
    expect(boundedRelationships.status).toBe(200);
    expect(boundedRelationshipsBody.relationships?.find((row) => row.id === created.relationship.id)?.attribution).toEqual({ leads: 0, converted: 0 });
    const malformedAttributionRange = await businessRelationshipListHandler(new Request(`http://localhost/api/business-relationships?centreId=${centreId}&type=CORPORATE&attributionFrom=2099-02-30&attributionTo=2099-03-01`));
    expect(malformedAttributionRange.status).toBe(400);
    const linkedView = await businessRelationshipLeadsHandler(new Request(`http://localhost/api/business-relationships/${created.relationship.id}/leads?centreId=${centreId}&type=CORPORATE&page=1`), { params: Promise.resolve({ id: created.relationship.id }) });
    expect(linkedView.status).toBe(200);
    const linkedViewBody = await linkedView.json() as { leads: Array<{ id: string; leadNumber: string }>; page: number; pageSize: number; hasMore: boolean; privacy: string };
    expect(linkedViewBody).toMatchObject({ page: 1, pageSize: 50, hasMore: true, privacy: "CONTACT_DETAILS_OMITTED" });
    expect(linkedViewBody.leads).toHaveLength(50);
    expect(linkedViewBody.leads[0]).toEqual(expect.objectContaining({ id: linkedLead.lead.id, leadNumber: linkedLead.lead.leadNumber }));
    expect(linkedViewBody).not.toHaveProperty("appointments");
    const linkedViewPage2 = await businessRelationshipLeadsHandler(new Request(`http://localhost/api/business-relationships/${created.relationship.id}/leads?centreId=${centreId}&type=CORPORATE&page=2`), { params: Promise.resolve({ id: created.relationship.id }) });
    const linkedViewPage2Body = await linkedViewPage2.json() as { leads: Array<{ id: string }>; page: number; pageSize: number; hasMore: boolean };
    expect(linkedViewPage2Body).toMatchObject({ page: 2, pageSize: 50, hasMore: false });
    expect(linkedViewPage2Body.leads).toHaveLength(2);
    expect(linkedViewBody.leads.map((lead) => lead.id)).not.toContain(linkedViewPage2Body.leads[0].id);
    expect(linkedViewBody.privacy).toBe("CONTACT_DETAILS_OMITTED");
    expect(JSON.stringify(linkedViewBody)).not.toContain("referral@synthetic.invalid");
    const noLeadPermission = mocks.getApiAccess;
    noLeadPermission.mockImplementation(async (permission: string, requestedCentre?: string) => {
      const available = grants.filter((grant) => grant.key !== "leads.read");
      return (!requestedCentre || requestedCentre === centreId) && available.some((grant) => grant.key === permission)
        ? { staff: { organizationId, staffUserId, grants: available }, response: null }
        : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) };
    });
    const restrictedDirectory = await businessRelationshipListHandler(new Request(`http://localhost/api/business-relationships?centreId=${centreId}&type=CORPORATE&category=${category}`));
    const restrictedData = await restrictedDirectory.json() as { relationships: Array<{ id: string; attribution?: unknown }> };
    expect(restrictedData.relationships).toEqual([expect.objectContaining({ id: created.relationship.id })]);
    expect(restrictedData.relationships[0]).not.toHaveProperty("attribution");
    expect((await businessRelationshipLeadsHandler(new Request(`http://localhost/api/business-relationships/${created.relationship.id}/leads?centreId=${centreId}&type=CORPORATE`), { params: Promise.resolve({ id: created.relationship.id }) })).status).toBe(403);
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => (!requestedCentre || requestedCentre === centreId) && grants.some((grant) => grant.key === permission)
      ? { staff: { organizationId, staffUserId, grants }, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    const appointmentId = randomUUID();
    const appointmentCiphertext = encryptOperationalData({ privateNote: "Synthetic private appointment detail" }, operationalContext({ organizationId, centreId, recordId: appointmentId }, "appointment"));
    await pool.query("INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,lead_id,booking_source,visit_type,scheduled_at,duration_minutes,time_zone,status,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,$6,'CRM_LEAD','CENTRE','2099-01-10T09:00:00Z',30,'Asia/Kolkata','REQUESTED',$7,$8,$9,$10)", [appointmentId, organizationId, centreId, `RHC-A-${appointmentId.slice(0, 8).toUpperCase()}`, patientId, linkedLead.lead.id, appointmentCiphertext, staffUserId, randomUUID(), "a".repeat(64)]);
    grants.push({ key: "appointments.read", centreId });
    const appointmentActivity = await businessRelationshipLeadsHandler(new Request(`http://localhost/api/business-relationships/${created.relationship.id}/leads?centreId=${centreId}&type=CORPORATE&appointmentPage=1`), { params: Promise.resolve({ id: created.relationship.id }) });
    expect(appointmentActivity.status).toBe(200);
    const appointmentActivityBody = await appointmentActivity.json() as { appointments?: Array<{ id: string; appointmentNumber: string; leadNumber: string; status: string; visitType: string }>; appointmentPage: number; appointmentsHaveMore: boolean };
    expect(appointmentActivityBody).toMatchObject({ appointmentPage: 1, appointmentsHaveMore: false, appointments: [{ id: appointmentId, leadNumber: linkedLead.lead.leadNumber, status: "REQUESTED", visitType: "CENTRE" }] });
    expect(appointmentActivityBody.appointments?.[0].appointmentNumber).toContain("RHC-A-");
    expect(JSON.stringify(appointmentActivityBody)).not.toContain("Synthetic private appointment detail");
    expect(JSON.stringify(appointmentActivityBody)).not.toContain(patientId);
    const extraAppointmentIds = Array.from({ length: 25 }, () => randomUUID());
    const extraAppointmentNumbers = extraAppointmentIds.map((appointmentId) => `RHC-A-${appointmentId.slice(0, 8).toUpperCase()}`);
    const extraAppointmentKeys = Array.from({ length: 25 }, () => randomUUID());
    const extraAppointmentCiphertexts = extraAppointmentIds.map((extraId) => encryptOperationalData({ privateNote: "Synthetic paginated appointment" }, operationalContext({ organizationId, centreId, recordId: extraId }, "appointment")));
    await pool.query(`INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,lead_id,booking_source,visit_type,scheduled_at,duration_minutes,time_zone,status,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash)
      SELECT seed.id,$1,$2,seed.appointment_number,$3,$4,'CRM_LEAD','CENTRE','2099-01-11T09:00:00Z',30,'Asia/Kolkata','REQUESTED',seed.cipher,$5,seed.idempotency_key,repeat('b',64)
      FROM unnest($6::uuid[],$7::text[],$8::uuid[],$9::text[]) AS seed(id,appointment_number,idempotency_key,cipher)`, [organizationId, centreId, patientId, linkedLead.lead.id, staffUserId, extraAppointmentIds, extraAppointmentNumbers, extraAppointmentKeys, extraAppointmentCiphertexts]);
    const firstAppointmentPage = await businessRelationshipLeadsHandler(new Request(`http://localhost/api/business-relationships/${created.relationship.id}/leads?centreId=${centreId}&type=CORPORATE&appointmentPage=1`), { params: Promise.resolve({ id: created.relationship.id }) });
    const firstAppointmentPageBody = await firstAppointmentPage.json() as { appointments?: Array<{ id: string }>; appointmentPage: number; appointmentsHaveMore: boolean };
    expect(firstAppointmentPageBody).toMatchObject({ appointmentPage: 1, appointmentsHaveMore: true });
    expect(firstAppointmentPageBody.appointments).toHaveLength(25);
    const secondAppointmentPage = await businessRelationshipLeadsHandler(new Request(`http://localhost/api/business-relationships/${created.relationship.id}/leads?centreId=${centreId}&type=CORPORATE&appointmentPage=2`), { params: Promise.resolve({ id: created.relationship.id }) });
    const secondAppointmentPageBody = await secondAppointmentPage.json() as { appointments?: Array<{ id: string }>; appointmentPage: number; appointmentsHaveMore: boolean };
    expect(secondAppointmentPageBody).toMatchObject({ appointmentPage: 2, appointmentsHaveMore: false });
    expect(secondAppointmentPageBody.appointments).toHaveLength(1);
    expect(new Set([...(firstAppointmentPageBody.appointments ?? []), ...(secondAppointmentPageBody.appointments ?? [])].map((row) => row.id)).size).toBe(26);
    // Keep the new CRM booking out of the pagination fixture until all 26 historical rows are asserted.
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: bookingGrants }, response: null });
    const bookingKey = randomUUID();
    const bookingBody = { centreId, patientId: convertedPatientId, leadId: linkedLead.lead.id, source: "CRM_LEAD", visitType: "CENTRE", scheduledLocal: "2099-02-03T11:30", durationMinutes: 30, services: [{ type: "OTHER", name: "SYNTH-CORPORATE-BOOKING" }] };
    const bookingRequest = (body: typeof bookingBody, key: string = bookingKey) => new Request("http://localhost/api/appointments", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });
    const bookingResponse = await handler(bookingRequest(bookingBody));
    expect(bookingResponse.status, JSON.stringify(await bookingResponse.clone().json())).toBe(201);
    const booking = await bookingResponse.json() as { appointment: { id: string } };
    expect((await handler(bookingRequest(bookingBody))).status).toBe(200);
    expect((await pool.query("SELECT count(*)::int AS count FROM appointments WHERE idempotency_key=$1 AND lead_id=$2 AND patient_id=$3", [bookingKey, linkedLead.lead.id, convertedPatientId])).rows[0].count).toBe(1);
    const wrongPatientBooking = await handler(bookingRequest({ ...bookingBody, patientId: randomUUID() }, randomUUID()));
    expect(wrongPatientBooking.status).toBe(409);
    expect((await wrongPatientBooking.json() as { error: string }).error).toBe("lead_patient_link_not_verified");
    expect((await pool.query("SELECT id FROM appointments WHERE id=$1", [booking.appointment.id])).rowCount).toBe(1);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: bookingGrants.filter((grant) => grant.key !== "appointments.create") }, response: null });
    const restrictedLeadDetail = await leadReadHandler(new Request(`http://localhost/api/leads/${linkedLead.lead.id}`), { params: Promise.resolve({ id: linkedLead.lead.id }) });
    expect((await restrictedLeadDetail.json() as { capabilities: { appointmentCreate: boolean } }).capabilities.appointmentCreate).toBe(false);
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentre?: string) => (!requestedCentre || requestedCentre === centreId) && grants.some((grant) => grant.key === permission)
      ? { staff: { organizationId, staffUserId, grants }, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    expect((await businessRelationshipLeadsHandler(new Request(`http://localhost/api/business-relationships/${created.relationship.id}/leads?centreId=${randomUUID()}&type=CORPORATE`), { params: Promise.resolve({ id: created.relationship.id }) })).status).toBe(403);
    const activityKey = randomUUID();
    const activityRequest = () => new Request(`http://localhost/api/business-relationships/${created.relationship.id}/activities`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": activityKey }, body: JSON.stringify({ centreId, type: "CORPORATE", category: "MEETING", serviceReference: "SYNTH-MTG-1", note: "Internal synthetic meeting note", occurredAt: null }) });
    expect((await businessRelationshipActivityHandler(activityRequest(), { params: Promise.resolve({ id: created.relationship.id }) })).status).toBe(201);
    expect((await businessRelationshipActivityHandler(activityRequest(), { params: Promise.resolve({ id: created.relationship.id }) })).status).toBe(200);
    const changedActivityReplay = await businessRelationshipActivityHandler(new Request(`http://localhost/api/business-relationships/${created.relationship.id}/activities`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": activityKey }, body: JSON.stringify({ centreId, type: "CORPORATE", category: "MEETING", serviceReference: "SYNTH-MTG-1", note: "Different private synthetic note", occurredAt: null }) }), { params: Promise.resolve({ id: created.relationship.id }) });
    expect(changedActivityReplay.status).toBe(409);
    const updateKey = randomUUID();
    const updateBody = { centreId, type: "CORPORATE", expectedVersion: 1, category: "EMPLOYER", status: "INACTIVE", privateData: { ...createBody.privateData, name: "Synthetic Works Updated" } };
    const updateRequest = () => new Request(`http://localhost/api/business-relationships/${created.relationship.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": updateKey }, body: JSON.stringify(updateBody) });
    expect((await businessRelationshipUpdateHandler(updateRequest(), { params: Promise.resolve({ id: created.relationship.id }) })).status).toBe(200);
    await expect((await businessRelationshipUpdateHandler(updateRequest(), { params: Promise.resolve({ id: created.relationship.id }) })).json()).resolves.toMatchObject({ replayed: true });
    const changedUpdateReplay = await businessRelationshipUpdateHandler(new Request(`http://localhost/api/business-relationships/${created.relationship.id}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": updateKey }, body: JSON.stringify({ ...updateBody, privateData: { ...updateBody.privateData, notes: "Different private synthetic note" } }) }), { params: Promise.resolve({ id: created.relationship.id }) });
    expect(changedUpdateReplay.status).toBe(409);
    const detail = await businessRelationshipReadHandler(new Request(`http://localhost/api/business-relationships/${created.relationship.id}?centreId=${centreId}&type=CORPORATE`), { params: Promise.resolve({ id: created.relationship.id }) });
    expect(detail.status).toBe(200);
    const result = await detail.json() as { relationship: { name: string; status: string; version: number }; history: Array<{ type: string; note?: string }> };
    expect(result.relationship).toMatchObject({ name: "Synthetic Works Updated", status: "INACTIVE", version: 2 });
    expect(result.history).toEqual(expect.arrayContaining([expect.objectContaining({ type: "ACTIVITY_RECORDED", note: "Internal synthetic meeting note" })]));
    for (const suffix of ["A", "B"]) {
      const pageBody = { ...createBody, category: "SYNTHETIC_PAGE", privateData: { ...createBody.privateData, name: `Synthetic Page ${suffix}` } };
      const pageCreate = await businessRelationshipCreateHandler(new Request("http://localhost/api/business-relationships", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify(pageBody) }));
      expect(pageCreate.status, JSON.stringify(await pageCreate.clone().json())).toBe(201);
    }
    const firstRelationshipPage = await businessRelationshipListHandler(new Request(`http://localhost/api/business-relationships?centreId=${centreId}&type=CORPORATE&category=SYNTHETIC_PAGE&page=1&pageSize=1`));
    const firstRelationshipPageBody = await firstRelationshipPage.json() as { relationships: Array<{ id: string }>; page: number; pageSize: number; hasMore: boolean };
    expect(firstRelationshipPageBody).toMatchObject({ page: 1, pageSize: 1, hasMore: true });
    expect(firstRelationshipPageBody.relationships).toHaveLength(1);
    const secondRelationshipPage = await businessRelationshipListHandler(new Request(`http://localhost/api/business-relationships?centreId=${centreId}&type=CORPORATE&category=SYNTHETIC_PAGE&page=2&pageSize=1`));
    const secondRelationshipPageBody = await secondRelationshipPage.json() as { relationships: Array<{ id: string }>; page: number; pageSize: number; hasMore: boolean };
    expect(secondRelationshipPageBody).toMatchObject({ page: 2, pageSize: 1, hasMore: false });
    expect(secondRelationshipPageBody.relationships).toHaveLength(1);
    expect(secondRelationshipPageBody.relationships[0].id).not.toBe(firstRelationshipPageBody.relationships[0].id);
    const pickerRelationshipIds = Array.from({ length: 51 }, () => randomUUID());
    const pickerRelationshipNumbers = pickerRelationshipIds.map((id) => `RHC-C-2026-SYN-${id.slice(0, 8).toUpperCase()}`);
    const pickerRelationshipCiphertexts = pickerRelationshipIds.map((id, index) => sealBusinessRelationship({ organizationId, centreId, id }, "CORPORATE", { name: `Synthetic attribution ${index}`, legalName: null, primaryContactName: null, primaryContactRole: null, phone: null, email: null, address: null, agreementReference: null, agreementStatus: "NOT_RECORDED", notes: null }));
    await pool.query(`INSERT INTO business_relationships(id,organization_id,centre_id,relationship_type,relationship_number,category,status,private_data_ciphertext,created_by_staff_id,updated_by_staff_id)
      SELECT seeded.id,$1,$2,'CORPORATE',seeded.number,'ATTRIBUTION_QUEUE','ACTIVE',seeded.cipher,$3,$3 FROM unnest($4::uuid[],$5::text[],$6::text[]) AS seeded(id,number,cipher)`, [organizationId, centreId, staffUserId, pickerRelationshipIds, pickerRelationshipNumbers, pickerRelationshipCiphertexts]);
    const pickerRelationshipsPage1 = await businessRelationshipListHandler(new Request(`http://localhost/api/business-relationships?centreId=${centreId}&type=CORPORATE&status=ACTIVE&category=ATTRIBUTION_QUEUE&page=1&pageSize=50`));
    const pickerRelationshipsBody1 = await pickerRelationshipsPage1.json() as { relationships: Array<{ id: string; name: string }>; page: number; pageSize: number; hasMore: boolean };
    expect(pickerRelationshipsBody1).toMatchObject({ page: 1, pageSize: 50, hasMore: true });
    expect(pickerRelationshipsBody1.relationships).toHaveLength(50);
    const pickerRelationshipsPage2 = await businessRelationshipListHandler(new Request(`http://localhost/api/business-relationships?centreId=${centreId}&type=CORPORATE&status=ACTIVE&category=ATTRIBUTION_QUEUE&page=2&pageSize=50`));
    const pickerRelationshipsBody2 = await pickerRelationshipsPage2.json() as { relationships: Array<{ id: string; name: string }>; page: number; pageSize: number; hasMore: boolean };
    expect(pickerRelationshipsBody2).toMatchObject({ page: 2, pageSize: 50, hasMore: false });
    expect(pickerRelationshipsBody2.relationships).toHaveLength(1);
    expect(new Set([...pickerRelationshipsBody1.relationships, ...pickerRelationshipsBody2.relationships].map((row) => row.id)).size).toBe(51);
    const crossCentre = await businessRelationshipReadHandler(new Request(`http://localhost/api/business-relationships/${created.relationship.id}?centreId=${randomUUID()}&type=CORPORATE`), { params: Promise.resolve({ id: created.relationship.id }) });
    expect(crossCentre.status).toBe(403);
    const noPartnerGrant = await businessRelationshipListHandler(new Request(`http://localhost/api/business-relationships?centreId=${centreId}&type=PARTNER`));
    expect(noPartnerGrant.status).toBe(403);
    const eventCipher = await pool.query("SELECT private_data_ciphertext FROM business_relationship_events WHERE relationship_id=$1 AND event_type='ACTIVITY_RECORDED'", [created.relationship.id]);
    expect(eventCipher.rows[0].private_data_ciphertext).not.toContain("Internal synthetic meeting note");
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }, { key: "appointments.update", centreId }, { key: "appointments.assign", centreId }, { key: "roster.read", centreId }, { key: "finance.read", centreId }] }, response: null });
  });

  it("rolls back the appointment when service persistence fails mid-transaction", async () => {
    const beforeCount = await pool.query("SELECT count(*)::int AS count FROM appointments WHERE organization_id=$1 AND centre_id=$2", [organizationId, centreId]);
    await pool.query(`CREATE FUNCTION ${failureFunction}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic test failure' USING ERRCODE='23514'; END $$`);
    await pool.query(`CREATE TRIGGER ${failureTrigger} BEFORE INSERT ON appointment_services FOR EACH ROW EXECUTE FUNCTION ${failureFunction}()`);
    const response = await handler(request(randomUUID()));
    expect(response.status).toBe(500);
    const count = await pool.query("SELECT count(*)::int AS count FROM appointments WHERE organization_id=$1 AND centre_id=$2", [organizationId, centreId]);
    expect(count.rows[0].count).toBe(beforeCount.rows[0].count);
    await pool.query(`DROP TRIGGER ${failureTrigger} ON appointment_services`);
    await pool.query(`DROP FUNCTION ${failureFunction}()`);
  });
});
