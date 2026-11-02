import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";
import { encryptLeadValue } from "@/server/lead-crypto";
import { publicEnquiryContext } from "@/server/public-enquiry-policy";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("owner analytics PostgreSQL authorization and aggregation", () => {
  const { Pool } = pg;
  const schema = `p2_09a_owner_analytics_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = ""; let pool: InstanceType<typeof Pool>; let dropPool: InstanceType<typeof Pool> | undefined;
  let handler: typeof import("./route").GET; let organizationId: string; let centreId: string; let otherCentreId: string; let staffUserId: string;

  beforeAll(async () => {
    loadProjectEnvironment();
    testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) throw new Error("A dedicated PostgreSQL test database is required.");
    const admin = new Pool({ connectionString: testUrl, max: 1 }); await admin.query(`CREATE SCHEMA "${schema}"`); await admin.end();
    await runMigrations(testUrl, null, schema);
    const scopedUrl = new URL(testUrl); scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`); process.env.DATABASE_URL = scopedUrl.toString(); pool = new Pool({ connectionString: scopedUrl.toString(), max: 2 });
    organizationId = randomUUID(); centreId = randomUUID(); otherCentreId = randomUUID(); staffUserId = randomUUID(); const authId = randomUUID();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `OA-${organizationId.slice(0, 8)}`, "Synthetic analytics test"]);
    for (const id of [centreId, otherCentreId]) await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [id, organizationId, `C-${id.slice(0, 8)}`, "Synthetic Centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authId, "Synthetic analytics reader", `${authId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [staffUserId, authId, organizationId, `ST-${staffUserId.slice(0, 8)}`, "Synthetic analytics reader"]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "appointments.read", centreId }, { key: "leads.read", centreId }, { key: "patients.read", centreId }, { key: "tasks.read", centreId }, { key: "escalations.read", centreId }, { key: "samples.receive", centreId }, { key: "samples.dispatch", centreId }, { key: "samples.exceptions.manage", centreId }] }, response: null });
    ({ GET: handler } = await import("./route"));
  }, 120_000);

  afterAll(async () => { try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ } await pool?.end(); if (testUrl) { dropPool = new Pool({ connectionString: testUrl, max: 1 }); await dropPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await dropPool.end(); process.env.DATABASE_URL = testUrl; } }, 60_000);

  it("returns only authorized aggregate metrics and omits unauthorized module counts", async () => {
    const patientId = randomUUID(); const leadId = randomUUID(); const convertedAt = new Date("2026-10-15T10:00:00.000Z");
    const enquiryId = randomUUID();
    const enquiryPrivateData = encryptLeadValue("private-data", { firstName: "Synthetic", lastName: "Enquiry", organizationName: null, phone: null, email: null, category: "GENERAL", requestTopic: "GENERAL", message: "Synthetic enquiry fixture", requestKind: "INQUIRY", requestedService: null, preferredDate: null, preferredTimeWindow: null, visitType: null, collectionAddress: null, responsePermission: false, responsePermissionTextVersion: "PUBLIC_ENQUIRY_RESPONSE_V1", submittedAt: convertedAt.toISOString() }, publicEnquiryContext({ organizationId, centreId, id: enquiryId }));
    await pool.query("INSERT INTO public_enquiries(id,organization_id,centre_id,enquiry_number,status,private_data_ciphertext,idempotency_key,request_fingerprint,created_at) VALUES($1,$2,$3,$4,'PENDING_REVIEW',$5,$6,$7,$8)", [enquiryId, organizationId, centreId, `ENQ-${enquiryId.slice(0, 8)}`, enquiryPrivateData, randomUUID(), "d".repeat(64), convertedAt]);
    await pool.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,created_by_staff_id,created_at) VALUES($1,$2,$3,$4,'NOT_RECORDED',$5,$6)", [patientId, organizationId, centreId, `P-${patientId.slice(0, 8)}`, staffUserId, convertedAt]);
    await pool.query("INSERT INTO leads(id,organization_id,centre_id,lead_number,enquiry_category,source,assigned_staff_id,created_by_staff_id,created_at,updated_at) VALUES($1,$2,$3,$4,'GENERAL','WEBSITE',$5,$5,$6,$6)", [leadId, organizationId, centreId, `L-${leadId.slice(0, 8)}`, staffUserId, convertedAt]);
    await pool.query("INSERT INTO lead_conversions(id,organization_id,centre_id,lead_id,patient_id,conversion_mode,converted_by_staff_id,converted_at) VALUES($1,$2,$3,$4,$5,'NEW',$6,$7)", [randomUUID(), organizationId, centreId, leadId, patientId, staffUserId, convertedAt]);
    const appointmentId = randomUUID();
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    const appointmentPrivateData = encryptOperationalData({ homeCollectionAddress: null, collectionInstructions: null, communicationEvidenceReference: null, homeChargeReason: null }, operationalContext({ organizationId, centreId, recordId: appointmentId }, "appointment"));
    await pool.query("INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,booking_source,visit_type,scheduled_at,duration_minutes,time_zone,status,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'STAFF','CENTRE',$6,30,'Asia/Kolkata','REQUESTED',$7,$8,$9,$10,$11,$11)", [appointmentId, organizationId, centreId, `A-${appointmentId.slice(0, 8)}`, patientId, convertedAt, appointmentPrivateData, staffUserId, randomUUID(), "f".repeat(64), convertedAt]);
    const orderId = randomUUID();
    await pool.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id,created_at,updated_at) VALUES($1,$2,$3,$4,$5,$6,'PENDING_VERIFICATION',$7,$8,$9,$10,$10)", [orderId, organizationId, centreId, `O-${orderId.slice(0, 8)}`, patientId, appointmentId, randomUUID(), "c".repeat(64), staffUserId, convertedAt]);
    const jobId = randomUUID();
    await pool.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,assigned_staff_id,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'COLLECTED',$8,$9,$10,$11,$8)", [jobId, organizationId, centreId, `CJ-${jobId.slice(0, 8)}`, appointmentId, orderId, patientId, staffUserId, convertedAt, new Date(convertedAt.getTime() + 30 * 60_000), randomUUID()]);
    const collectionProcedureId = randomUUID(); const receivingProcedureId = randomUUID();
    for (const [id, operation] of [[collectionProcedureId, "COLLECTION"], [receivingProcedureId, "RECEIVING"]]) await pool.query("INSERT INTO sample_procedure_approvals(id,organization_id,centre_id,operation,reference,status,approved_by_staff_id) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6)", [id, organizationId, centreId, operation, `Synthetic ${operation.toLowerCase()} reference`, staffUserId]);
    const specimenIds = [randomUUID(), randomUUID(), randomUUID()]; const dispatchId = randomUUID(); const handedOverBatchId = randomUUID();
    const preparingBatchSecret = encryptOperationalData({ carrierReference: null, externalLabReference: null }, operationalContext({ organizationId, centreId, recordId: dispatchId }, "dispatch-batch"));
    const handedOverBatchSecret = encryptOperationalData({ carrierReference: "SYNTHETIC-CARRIER-REF", externalLabReference: null }, operationalContext({ organizationId, centreId, recordId: handedOverBatchId }, "dispatch-batch"));
    await pool.query("INSERT INTO dispatch_batches(id,organization_id,centre_id,batch_number,status,private_data_ciphertext,created_by_staff_id) VALUES($1,$2,$3,$4,'PREPARING',$5,$6)", [dispatchId, organizationId, centreId, `DB-${dispatchId.slice(0, 8)}`, preparingBatchSecret, staffUserId]);
    await pool.query("INSERT INTO dispatch_batches(id,organization_id,centre_id,batch_number,status,private_data_ciphertext,handed_over_by_staff_id,handed_over_at,created_by_staff_id) VALUES($1,$2,$3,$4,'DISPATCHED',$5,$6,$7,$6)", [handedOverBatchId, organizationId, centreId, `DB-${handedOverBatchId.slice(0, 8)}`, handedOverBatchSecret, staffUserId, convertedAt]);
    for (const [index, id] of specimenIds.entries()) {
      const status = ["COLLECTED", "RECEIVED_AT_RUDRA", "PACKED"][index];
      const secret = encryptOperationalData({ specimenType: "Synthetic specimen", requirementReference: "SYNTHETIC-ONLY", collectionNote: null }, operationalContext({ organizationId, centreId, recordId: id }, "specimen"));
      await pool.query("INSERT INTO specimens(id,organization_id,centre_id,job_id,order_id,patient_id,specimen_number,idempotency_key,private_data_ciphertext,status,identity_check_confirmed,collection_procedure_approval_id,collected_by_staff_id,received_by_staff_id,received_at,receiving_procedure_approval_id,dispatch_batch_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,true,$11,$12,$13,$14,$15,$16)", [id, organizationId, centreId, jobId, orderId, patientId, `SP-${id.slice(0, 8)}`, randomUUID(), secret, status, collectionProcedureId, staffUserId, index === 0 ? null : staffUserId, index === 0 ? null : convertedAt, index === 0 ? null : receivingProcedureId, index === 2 ? dispatchId : null]);
    }
    const exceptionId = randomUUID();
    const exceptionSecret = encryptOperationalData({ reason: "Synthetic sample-label review" }, operationalContext({ organizationId, centreId, recordId: exceptionId }, "sample-exception"));
    await pool.query("INSERT INTO sample_exceptions(id,organization_id,centre_id,specimen_id,exception_type,private_data_ciphertext,status,recorded_by_staff_id) VALUES($1,$2,$3,$4,'MISSING_LABEL',$5,'OPEN',$6)", [exceptionId, organizationId, centreId, specimenIds[0], exceptionSecret, staffUserId]);
    const taskId = randomUUID();
    const taskPrivateData = encryptOperationalData({ title: "Synthetic analytics task", description: "Synthetic operational queue fixture" }, operationalContext({ organizationId, centreId, recordId: taskId }, "staff-task"));
    await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,requires_approval,approval_status,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'GENERAL','NORMAL','OPEN',false,'NOT_REQUIRED',$6,$6,$7,$8)", [taskId, organizationId, centreId, `T-${taskId.slice(0, 8)}`, taskPrivateData, staffUserId, randomUUID(), "a".repeat(64)]);
    const escalationId = randomUUID();
    const escalationPrivateData = encryptOperationalData({ title: "Synthetic analytics escalation", description: "Synthetic operational queue fixture" }, operationalContext({ organizationId, centreId, recordId: escalationId }, "staff-escalation"));
    await pool.query("INSERT INTO staff_escalations(id,organization_id,centre_id,escalation_number,source_type,source_id,private_data_ciphertext,severity,priority,status,assigned_owner_staff_id,created_by_staff_id,due_at,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'APPOINTMENT',$5,$6,'LOW','NORMAL','OPEN',$7,$7,$8,$9,$10)", [escalationId, organizationId, centreId, `E-${escalationId.slice(0, 8)}`, appointmentId, escalationPrivateData, staffUserId, new Date(Date.now() + 60_000), randomUUID(), "b".repeat(64)]);
    const response = await handler(new Request("http://localhost/api/owner/analytics?from=2026-10-01&to=2026-10-31"));
    expect(response.status).toBe(200);
    const body = await response.json() as { centres: Array<{ id: string; metrics: Record<string, number>; currentQueues: Record<string, number> }> };
    expect(body.centres).toHaveLength(1);
    expect(body.centres[0]).toMatchObject({ id: centreId, metrics: { websiteEnquiriesCreated: 1, appointmentsCreated: 1, leadsCreated: 1, leadsConverted: 1, patientsRegistered: 1 } });
    expect(body.centres[0].metrics).not.toHaveProperty("reportsRegistered");
    expect(body.centres[0].currentQueues).toMatchObject({ appointmentsAwaitingConfirmation: 1, tasksAwaitingAction: 1, openEscalations: 1, specimensAwaitingReceiving: 1, specimensAwaitingDispatch: 1, dispatchBatchesPreparing: 1, dispatchBatchesAwaitingReceipt: 1, sampleExceptionsOpen: 1 });
    expect(body.centres[0].currentQueues).not.toHaveProperty("reportsPendingVerification");
    expect(JSON.stringify(body)).not.toContain(staffUserId);
    expect(JSON.stringify(body)).not.toContain("Synthetic Enquiry");
    expect(JSON.stringify(body)).not.toContain("Synthetic enquiry fixture");
  });

  it("does not return center details or metric values for a center outside grants", async () => {
    const response = await handler(new Request(`http://localhost/api/owner/analytics?from=2026-10-01&to=2026-10-31&centreId=${otherCentreId}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ centres: [] });
  });

  it("omits sample queue counts without their distinct centre-scoped permissions", async () => {
    mocks.getApiAccess.mockResolvedValueOnce({ staff: { organizationId, staffUserId, grants: [{ key: "organization.read", centreId }, { key: "appointments.read", centreId }] }, response: null });
    const response = await handler(new Request(`http://localhost/api/owner/analytics?from=2026-10-01&to=2026-10-31&centreId=${centreId}`));
    expect(response.status).toBe(200);
    const body = await response.json() as { centres: Array<{ metrics: Record<string, number>; currentQueues: Record<string, number> }> };
    expect(body.centres[0].metrics).not.toHaveProperty("websiteEnquiriesCreated");
    expect(body.centres[0].currentQueues).not.toHaveProperty("specimensAwaitingReceiving");
    expect(body.centres[0].currentQueues).not.toHaveProperty("specimensAwaitingDispatch");
    expect(body.centres[0].currentQueues).not.toHaveProperty("dispatchBatchesPreparing");
    expect(body.centres[0].currentQueues).not.toHaveProperty("dispatchBatchesAwaitingReceipt");
    expect(body.centres[0].currentQueues).not.toHaveProperty("sampleExceptionsOpen");
  });
});
