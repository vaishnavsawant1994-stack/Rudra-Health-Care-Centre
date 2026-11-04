import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("assigned field exception queue PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_field_exceptions_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let previousDatabaseUrl: string | undefined;
  let pool: InstanceType<typeof Pool> | undefined;
  let getHandler: typeof import("./route").GET;
  let postHandler: typeof import("./route").POST;
  let organizationId: string;
  let allowedCentreId: string;
  let otherCentreId: string;
  let fieldStaffId: string;
  let otherStaffId: string;

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
    allowedCentreId = randomUUID();
    otherCentreId = randomUUID();
    fieldStaffId = randomUUID();
    otherStaffId = randomUUID();
    const fieldAuthId = randomUUID();
    const otherAuthId = randomUUID();
    const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();

    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `FE-${seed}`, "Synthetic field exception test"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata'),($5,$2,$6,$7,'Asia/Kolkata')", [allowedCentreId, organizationId, `FE-${seed}`, "Synthetic permitted centre", otherCentreId, `FX-${seed}`, "Synthetic restricted centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true),($4,$5,$6,true)', [fieldAuthId, "Synthetic Field Staff", `${seed.toLowerCase()}@invalid.test`, otherAuthId, "Synthetic Other Staff", `${seed.toLowerCase()}-other@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false),($6,$7,$3,$8,$9,'ACTIVE',false)", [fieldStaffId, fieldAuthId, organizationId, `FE-${seed}`, "Synthetic Field Staff", otherStaffId, otherAuthId, `FO-${seed}`, "Synthetic Other Staff"]);

    mocks.getApiAccess.mockImplementation(async (_permission: string, requestedCentreId?: string) => {
      if (requestedCentreId && requestedCentreId !== allowedCentreId) return { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) };
      return { response: null, staff: { organizationId, staffUserId: fieldStaffId, grants: [{ key: "collections.visit.record", centreId: allowedCentreId }] } };
    });
    ({ GET: getHandler, POST: postHandler } = await import("./route"));
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

  it("returns only open exceptions on the caller's assigned jobs in authorized centres", async () => {
    const addException = async (centreId: string, assigneeId: string, status: string) => {
      const patientId = randomUUID(); const appointmentId = randomUUID(); const orderId = randomUUID(); const jobId = randomUUID();
      const specimenId = randomUUID(); const procedureId = randomUUID(); const exceptionId = randomUUID();
      await pool!.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',$5)", [patientId, organizationId, centreId, `SYN-${patientId.slice(0, 8)}`, fieldStaffId]);
      await pool!.query("INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,booking_source,visit_type,scheduled_at,duration_minutes,time_zone,status,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'STAFF','HOME_COLLECTION','2099-01-05T05:00:00Z',30,'Asia/Kolkata','CONFIRMED','synthetic-private-appointment',$6,$7,$8)", [appointmentId, organizationId, centreId, `A-${appointmentId.slice(0, 8)}`, patientId, fieldStaffId, randomUUID(), "a".repeat(64)]);
      await pool!.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [orderId, organizationId, centreId, `O-${orderId.slice(0, 8)}`, patientId, appointmentId, randomUUID(), "b".repeat(64), fieldStaffId]);
      await pool!.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,assigned_staff_id,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'ASSIGNED',$8,'2099-01-05T05:00:00Z','2099-01-05T05:30:00Z',$9,$10)", [jobId, organizationId, centreId, `J-${jobId.slice(0, 8)}`, appointmentId, orderId, patientId, assigneeId, randomUUID(), fieldStaffId]);
      await pool!.query("INSERT INTO sample_procedure_approvals(id,organization_id,centre_id,operation,reference,status,approved_by_staff_id) VALUES($1,$2,$3,'COLLECTION',$4,'ACTIVE',$5)", [procedureId, organizationId, centreId, `SYN-${procedureId.slice(0, 8)}`, fieldStaffId]);
      await pool!.query("INSERT INTO specimens(id,organization_id,centre_id,job_id,order_id,patient_id,specimen_number,idempotency_key,private_data_ciphertext,status,identity_check_confirmed,collection_procedure_approval_id,collected_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'SYNTHETIC-PRIVATE-SPECIMEN-NOTE','EXCEPTION',true,$9,$10)", [specimenId, organizationId, centreId, jobId, orderId, patientId, `SP-${specimenId.slice(0, 8)}`, randomUUID(), procedureId, fieldStaffId]);
      await pool!.query("INSERT INTO sample_exceptions(id,organization_id,centre_id,specimen_id,exception_type,private_data_ciphertext,status,recorded_by_staff_id) VALUES($1,$2,$3,$4,'DAMAGED','SYNTHETIC-PRIVATE-EXCEPTION-REASON',$5,$6)", [exceptionId, organizationId, centreId, specimenId, status, fieldStaffId]);
      return { exceptionId, specimenId, centreId, specimenNumber: `SP-${specimenId.slice(0, 8)}` };
    };

    const allowed = await addException(allowedCentreId, fieldStaffId, "OPEN");
    const otherAssignee = await addException(allowedCentreId, otherStaffId, "OPEN");
    const otherCentre = await addException(otherCentreId, fieldStaffId, "OPEN");
    const closed = await addException(allowedCentreId, fieldStaffId, "RESOLVED");

    const response = await getHandler(new Request("http://localhost/api/field/exceptions"));
    expect(response.status).toBe(200);
    const body = await response.json() as { exceptions: Array<Record<string, unknown>>; hasMore: boolean };
    expect(body.exceptions).toHaveLength(1);
    expect(body.exceptions[0]).toMatchObject({ specimenNumber: allowed.specimenNumber, exceptionType: "DAMAGED", exceptionStatus: "OPEN" });
    const serialized = JSON.stringify(body);
    for (const secret of [otherAssignee.specimenNumber, otherCentre.specimenNumber, closed.specimenNumber, allowed.exceptionId, allowed.specimenId, "SYNTHETIC-PRIVATE-EXCEPTION-REASON", "SYNTHETIC-PRIVATE-SPECIMEN-NOTE"]) expect(serialized).not.toContain(secret);
  });

  it("denies an explicit out-of-scope centre without returning records", async () => {
    const response = await getHandler(new Request(`http://localhost/api/field/exceptions?centreId=${otherCentreId}`));
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    const write = await postHandler(new Request("http://localhost/api/field/exceptions", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ centreId: otherCentreId, specimenNumber: "SP-SYNTHETIC-OTHER-CENTRE", expectedVersion: 1, type: "DAMAGED", reason: "Synthetic out-of-scope request" }),
    }));
    expect(write.status).toBe(403);
    expect(await write.json()).toEqual({ error: "forbidden" });
  });

  it("records an assigned specimen exception once, encrypts its reason, and safely replays", async () => {
    const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    const patientId = randomUUID(); const appointmentId = randomUUID(); const orderId = randomUUID(); const jobId = randomUUID();
    const procedureId = randomUUID(); const specimenId = randomUUID();
    const appointmentPrivate = encryptOperationalData({ instructions: "synthetic appointment" }, operationalContext({ organizationId, centreId: allowedCentreId, recordId: appointmentId }, "appointment"));
    const specimenPrivate = encryptOperationalData({ specimenType: "Synthetic specimen", requirementReference: "SYNTHETIC-REQ" }, operationalContext({ organizationId, centreId: allowedCentreId, recordId: specimenId }, "specimen"));
    await pool!.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',$5)", [patientId, organizationId, allowedCentreId, `SYN-${seed}`, fieldStaffId]);
    await pool!.query("INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,booking_source,visit_type,scheduled_at,duration_minutes,time_zone,status,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'STAFF','HOME_COLLECTION','2099-01-05T05:00:00Z',30,'Asia/Kolkata','CONFIRMED',$6,$7,$8,$9)", [appointmentId, organizationId, allowedCentreId, `A-${seed}`, patientId, appointmentPrivate, fieldStaffId, randomUUID(), "c".repeat(64)]);
    await pool!.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [orderId, organizationId, allowedCentreId, `O-${seed}`, patientId, appointmentId, randomUUID(), "d".repeat(64), fieldStaffId]);
    await pool!.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,assigned_staff_id,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'ASSIGNED',$8,'2099-01-05T05:00:00Z','2099-01-05T05:30:00Z',$9,$10)", [jobId, organizationId, allowedCentreId, `J-${seed}`, appointmentId, orderId, patientId, fieldStaffId, randomUUID(), fieldStaffId]);
    await pool!.query("INSERT INTO sample_procedure_approvals(id,organization_id,centre_id,operation,reference,status,approved_by_staff_id) VALUES($1,$2,$3,'COLLECTION',$4,'ACTIVE',$5)", [procedureId, organizationId, allowedCentreId, `SYN-${seed}`, fieldStaffId]);
    await pool!.query("INSERT INTO specimens(id,organization_id,centre_id,job_id,order_id,patient_id,specimen_number,idempotency_key,private_data_ciphertext,status,identity_check_confirmed,collection_procedure_approval_id,collected_by_staff_id,version_number) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'COLLECTED',true,$10,$11,1)", [specimenId, organizationId, allowedCentreId, jobId, orderId, patientId, `SP-${seed}`, randomUUID(), specimenPrivate, procedureId, fieldStaffId]);

    const queueResponse = await getHandler(new Request("http://localhost/api/field/exceptions"));
    expect(queueResponse.status).toBe(200);
    const queue = await queueResponse.json() as { eligibleSpecimens: Array<Record<string, unknown>> };
    expect(queue.eligibleSpecimens).toContainEqual(expect.objectContaining({ centreId: allowedCentreId, specimenNumber: `SP-${seed}`, specimenStatus: "COLLECTED", versionNumber: 1 }));
    expect(JSON.stringify(queue)).not.toContain(patientId);
    expect(JSON.stringify(queue)).not.toContain(orderId);

    const idempotencyKey = randomUUID();
    const reason = "Synthetic packaging damage observed";
    const payload = { centreId: allowedCentreId, specimenNumber: `SP-${seed}`, expectedVersion: 1, type: "DAMAGED", reason };
    const send = (body: typeof payload) => postHandler(new Request("http://localhost/api/field/exceptions", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify(body),
    }));

    const first = await send(payload);
    expect(first.status).toBe(201);
    const firstBody = await first.json() as { result: { exceptionId: string; replayed: boolean; status: string; versionNumber: number } };
    expect(firstBody.result).toMatchObject({ replayed: false, status: "EXCEPTION", versionNumber: 2 });
    const replay = await send(payload);
    expect(replay.status).toBe(200);
    const replayBody = await replay.json() as { result: { exceptionId: string; replayed: boolean } };
    expect(replayBody.result).toEqual({ exceptionId: firstBody.result.exceptionId, specimenNumber: `SP-${seed}`, status: "EXCEPTION", versionNumber: 2, replayed: true });
    expect((await send({ ...payload, reason: "Different synthetic report" })).status).toBe(409);

    const persisted = await pool!.query("SELECT private_data_ciphertext FROM sample_exceptions WHERE id = $1", [firstBody.result.exceptionId]);
    expect(persisted.rowCount).toBe(1);
    expect(persisted.rows[0].private_data_ciphertext).not.toContain(reason);
    expect(decryptOperationalData<{ reason: string }>(persisted.rows[0].private_data_ciphertext, operationalContext({ organizationId, centreId: allowedCentreId, recordId: firstBody.result.exceptionId }, "sample-exception")).reason).toBe(reason);
    const specimenState = await pool!.query("SELECT status, version_number FROM specimens WHERE id=$1", [specimenId]);
    expect(specimenState.rows[0]).toMatchObject({ status: "EXCEPTION", version_number: 2 });
    const eventCount = await pool!.query("SELECT count(*)::int AS count FROM sample_custody_events WHERE specimen_id=$1 AND event_type='EXCEPTION_RECORDED' AND idempotency_key=$2", [specimenId, idempotencyKey]);
    expect(eventCount.rows[0].count).toBe(1);
    const exceptionCount = await pool!.query("SELECT count(*)::int AS count FROM sample_exceptions WHERE specimen_id=$1", [specimenId]);
    expect(exceptionCount.rows[0].count).toBe(1);
  });

  it("does not disclose or mutate a specimen assigned to another collector", async () => {
    const patientId = randomUUID(); const appointmentId = randomUUID(); const orderId = randomUUID(); const jobId = randomUUID();
    const specimenId = randomUUID(); const procedureId = randomUUID();
    const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    const appointmentPrivate = encryptOperationalData({ instructions: "synthetic appointment" }, operationalContext({ organizationId, centreId: allowedCentreId, recordId: appointmentId }, "appointment"));
    const specimenPrivate = encryptOperationalData({ specimenType: "Synthetic specimen", requirementReference: "SYNTHETIC-REQ" }, operationalContext({ organizationId, centreId: allowedCentreId, recordId: specimenId }, "specimen"));
    await pool!.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',$5)", [patientId, organizationId, allowedCentreId, `SYN-${seed}`, fieldStaffId]);
    await pool!.query("INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,booking_source,visit_type,scheduled_at,duration_minutes,time_zone,status,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'STAFF','HOME_COLLECTION','2099-01-05T05:00:00Z',30,'Asia/Kolkata','CONFIRMED',$6,$7,$8,$9)", [appointmentId, organizationId, allowedCentreId, `A-${seed}`, patientId, appointmentPrivate, fieldStaffId, randomUUID(), "e".repeat(64)]);
    await pool!.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [orderId, organizationId, allowedCentreId, `O-${seed}`, patientId, appointmentId, randomUUID(), "f".repeat(64), fieldStaffId]);
    await pool!.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,assigned_staff_id,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'ASSIGNED',$8,'2099-01-05T05:00:00Z','2099-01-05T05:30:00Z',$9,$10)", [jobId, organizationId, allowedCentreId, `J-${seed}`, appointmentId, orderId, patientId, otherStaffId, randomUUID(), fieldStaffId]);
    await pool!.query("INSERT INTO sample_procedure_approvals(id,organization_id,centre_id,operation,reference,status,approved_by_staff_id) VALUES($1,$2,$3,'COLLECTION',$4,'ACTIVE',$5)", [procedureId, organizationId, allowedCentreId, `SYN-${seed}`, fieldStaffId]);
    await pool!.query("INSERT INTO specimens(id,organization_id,centre_id,job_id,order_id,patient_id,specimen_number,idempotency_key,private_data_ciphertext,status,identity_check_confirmed,collection_procedure_approval_id,collected_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'COLLECTED',true,$10,$11)", [specimenId, organizationId, allowedCentreId, jobId, orderId, patientId, `SP-${seed}`, randomUUID(), specimenPrivate, procedureId, otherStaffId]);
    const response = await postHandler(new Request("http://localhost/api/field/exceptions", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ centreId: allowedCentreId, specimenNumber: `SP-${seed}`, expectedVersion: 1, type: "DAMAGED", reason: "Synthetic inaccessible specimen" }),
    }));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    const unchanged = await pool!.query("SELECT status, version_number FROM specimens WHERE id=$1", [specimenId]);
    expect(unchanged.rows[0]).toMatchObject({ status: "COLLECTED", version_number: 1 });
    const exceptionCount = await pool!.query("SELECT count(*)::int AS count FROM sample_exceptions WHERE specimen_id=$1", [specimenId]);
    expect(exceptionCount.rows[0].count).toBe(0);
  });
});
