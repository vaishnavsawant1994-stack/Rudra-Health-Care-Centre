import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "./load-project-env.mjs";
import { runMigrations } from "./migrate.mjs";
import { backfillOperationalData, decryptOperationalEnvelope, rotateOperationalDataKey } from "./encrypt-operational-data.mjs";

loadProjectEnvironment();
const { Pool } = pg;
const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required.");
const target = new URL(databaseUrl);
if (!/test/i.test(decodeURIComponent(target.pathname)) || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || decodeURIComponent(target.username) !== "rudra_test_runner") throw new Error("Refusing operational backfill qualification outside the local test-runner database.");

const schema = `p2_09a_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-operational-backfill-qualification" });
const scoped = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-operational-backfill-fixture", options: `-c search_path=${schema},public` });
let created = false;
const quiet = { log() {} };
const ids = Object.fromEntries(["org", "centre", "auth", "staff", "patient", "appointment", "service", "appointmentHistory", "assignmentHistory", "order", "procedure", "job", "jobEvent", "specimen", "batch", "custody", "receipt", "exception"].map((key) => [key, randomUUID()]));
const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
const at = new Date(Date.now() + 48 * 60 * 60_000);

try {
  await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
  await runMigrations(databaseUrl, "0034_drop_plaintext_lead_sensitive.sql", schema);
  const c = await scoped.connect();
  try {
    await c.query("BEGIN");
    await c.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [ids.org, `SYN-${seed}`, "Synthetic operational encryption qualification"]);
    await c.query("INSERT INTO centres(id,organization_id,code,name) VALUES($1,$2,$3,$4)", [ids.centre, ids.org, `SYN-${seed}`, "Synthetic centre"]);
    await c.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [ids.auth, "Synthetic staff", `${seed.toLowerCase()}@synthetic.invalid`]);
    await c.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status) VALUES($1,$2,$3,$4,$5,'ACTIVE')", [ids.staff, ids.auth, ids.org, `SYN-${seed}`, "Synthetic staff"]);
    await c.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,consent_recorded_at,consent_method,created_by_staff_id) VALUES($1,$2,$3,$4,'GRANTED',now(),'IN_PERSON',$5)", [ids.patient, ids.org, ids.centre, `SYN-P-${seed}`, ids.staff]);
    await c.query("INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,booking_source,visit_type,scheduled_at,time_zone,home_collection_address,home_collection_window,collection_instructions,home_charge_choice,home_charge_rupees,home_charge_reason,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'STAFF','HOME_COLLECTION',$6,'Asia/Kolkata',$7::jsonb,'Synthetic window','Synthetic collection instructions','75',75,NULL,$8,$9,$10)", [ids.appointment, ids.org, ids.centre, `SYN-A-${seed}`, ids.patient, at, JSON.stringify({ line1: "Synthetic Road 1", city: "Synthetic City", postalCode: "000001" }), ids.staff, randomUUID(), "a".repeat(64)]);
    await c.query("INSERT INTO appointment_services(id,organization_id,centre_id,appointment_id,service_type,service_name,service_reference) VALUES($1,$2,$3,$4,'OTHER','Synthetic service','SYN-SVC-1')", [ids.service, ids.org, ids.centre, ids.appointment]);
    await c.query("INSERT INTO appointment_status_history(id,organization_id,centre_id,appointment_id,to_status,reason,new_scheduled_at,actor_staff_id) VALUES($1,$2,$3,$4,'REQUESTED','Synthetic status reason',$5,$6)", [ids.appointmentHistory, ids.org, ids.centre, ids.appointment, at, ids.staff]);
    await c.query("INSERT INTO appointment_assignment_history(id,organization_id,centre_id,appointment_id,action,staff_id,work_start,work_end,reason,actor_staff_id) VALUES($1,$2,$3,$4,'ASSIGNED',$5,$6,$6::timestamptz+interval '30 minutes','Synthetic assignment reason',$5)", [ids.assignmentHistory, ids.org, ids.centre, ids.appointment, ids.staff, at]);
    await c.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [ids.order, ids.org, ids.centre, `SYN-O-${seed}`, ids.patient, ids.appointment, randomUUID(), "b".repeat(64), ids.staff]);
    await c.query("INSERT INTO sample_procedure_approvals(id,organization_id,centre_id,operation,reference,status,approved_by_staff_id) VALUES($1,$2,$3,'COLLECTION','SYNTHETIC-SOP','ACTIVE',$4)", [ids.procedure, ids.org, ids.centre, ids.staff]);
    await c.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,assigned_staff_id,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'ASSIGNED',$8,$9,$9::timestamptz+interval '30 minutes',$10,$8)", [ids.job, ids.org, ids.centre, `SYN-C-${seed}`, ids.appointment, ids.order, ids.patient, ids.staff, at, randomUUID()]);
    await c.query("INSERT INTO collection_job_events(id,organization_id,centre_id,job_id,event_type,source,reason,evidence_reference,actor_staff_id) VALUES($1,$2,$3,$4,'CREATED','STAFF','Synthetic job event','SYNTHETIC-EVIDENCE',$5)", [ids.jobEvent, ids.org, ids.centre, ids.job, ids.staff]);
    await c.query("INSERT INTO specimens(id,organization_id,centre_id,job_id,order_id,patient_id,specimen_number,idempotency_key,specimen_type,requirement_reference,status,identity_check_confirmed,collection_procedure_approval_id,collected_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'Synthetic specimen','SYNTHETIC-REQUIREMENT','COLLECTED',true,$9,$10)", [ids.specimen, ids.org, ids.centre, ids.job, ids.order, ids.patient, `SYN-S-${seed}`, randomUUID(), ids.procedure, ids.staff]);
    await c.query("INSERT INTO dispatch_batches(id,organization_id,centre_id,batch_number,status,carrier_reference,external_lab_reference,created_by_staff_id) VALUES($1,$2,$3,$4,'PREPARING','SYNTHETIC-CARRIER','SYNTHETIC-LAB-REF',$5)", [ids.batch, ids.org, ids.centre, `SYN-D-${seed}`, ids.staff]);
    await c.query("INSERT INTO sample_custody_events(id,organization_id,centre_id,specimen_id,event_type,source,evidence_reference,reason,actor_staff_id) VALUES($1,$2,$3,$4,'COLLECTED','STAFF_RECORDED','SYNTHETIC-CUSTODY-REF','Synthetic custody reason',$5)", [ids.custody, ids.org, ids.centre, ids.specimen, ids.staff]);
    await c.query("INSERT INTO sample_external_receipts(id,organization_id,centre_id,batch_id,receipt_reference,evidence_reference,verification_status,recorded_by_staff_id) VALUES($1,$2,$3,$4,'SYNTHETIC-RECEIPT','SYNTHETIC-RECEIPT-EVIDENCE','PENDING_REVIEW',$5)", [ids.receipt, ids.org, ids.centre, ids.batch, ids.staff]);
    await c.query("INSERT INTO sample_exceptions(id,organization_id,centre_id,specimen_id,exception_type,reason,status,recorded_by_staff_id,resolution_reference) VALUES($1,$2,$3,$4,'OTHER','Synthetic exception reason','OPEN',$5,'SYNTHETIC-RESOLUTION-REF')", [ids.exception, ids.org, ids.centre, ids.specimen, ids.staff]);
    await c.query("COMMIT");
  } catch (error) { await c.query("ROLLBACK").catch(() => {}); throw error; }
  finally { c.release(); }

  const options = { databaseUrl, schema, logger: quiet };
  await runMigrations(databaseUrl, "0035_operational_sensitive_encryption_prepare.sql", schema);
  let interrupted = false;
  try { await backfillOperationalData({ ...options, interruptAfterFirstBatch: true }); } catch (error) { interrupted = error instanceof Error && error.message === "synthetic_backfill_interruption"; }
  if (!interrupted) throw new Error("Synthetic operational backfill interruption was not exercised.");
  const resumed = await backfillOperationalData(options);
  if (resumed.processed < 9) throw new Error("Populated operational backfill did not resume the remaining synthetic records.");

  const verify = await scoped.connect();
  try {
    const checks = [
      ["appointments", ids.appointment, "appointment", { homeCollectionAddress: { line1: "Synthetic Road 1", city: "Synthetic City", postalCode: "000001" }, collectionInstructions: "Synthetic collection instructions", communicationEvidenceReference: null, homeChargeReason: null }],
      ["appointment_services", ids.service, "appointment-service", { serviceName: "Synthetic service", serviceReference: "SYN-SVC-1" }],
      ["appointment_status_history", ids.appointmentHistory, "appointment-status-history", { reason: "Synthetic status reason" }],
      ["appointment_assignment_history", ids.assignmentHistory, "appointment-assignment-history", { reason: "Synthetic assignment reason" }],
      ["collection_job_events", ids.jobEvent, "collection-job-event", { reason: "Synthetic job event", evidenceReference: "SYNTHETIC-EVIDENCE" }],
      ["specimens", ids.specimen, "specimen", { specimenType: "Synthetic specimen", requirementReference: "SYNTHETIC-REQUIREMENT" }],
      ["dispatch_batches", ids.batch, "dispatch-batch", { carrierReference: "SYNTHETIC-CARRIER", externalLabReference: "SYNTHETIC-LAB-REF" }],
      ["sample_custody_events", ids.custody, "sample-custody-event", { evidenceReference: "SYNTHETIC-CUSTODY-REF", reason: "Synthetic custody reason" }],
      ["sample_external_receipts", ids.receipt, "sample-external-receipt", { receiptReference: "SYNTHETIC-RECEIPT", evidenceReference: "SYNTHETIC-RECEIPT-EVIDENCE" }],
      ["sample_exceptions", ids.exception, "sample-exception", { reason: "Synthetic exception reason", resolutionReference: "SYNTHETIC-RESOLUTION-REF" }],
    ];
    for (const [table, id] of checks) {
      const row = await verify.query(`SELECT organization_id,centre_id,private_data_ciphertext FROM "${table}" WHERE id=$1`, [id]);
      if (!row.rowCount || !row.rows[0].private_data_ciphertext) throw new Error(`Synthetic encrypted row missing in ${table}.`);
      if (!row.rows[0].private_data_ciphertext.startsWith("v1.")) throw new Error(`Invalid ciphertext envelope in ${table}.`);
    }
    const custodyCount = await verify.query("SELECT count(*)::int AS count FROM sample_custody_events WHERE specimen_id=$1", [ids.specimen]);
    if (custodyCount.rows[0].count !== 1) throw new Error("Synthetic custody relationship was not preserved.");
  } finally { verify.release(); }

  await runMigrations(databaseUrl, "0036_drop_plaintext_operational_sensitive.sql", schema);
  const columns = await scoped.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1", [schema]);
  const fields = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const legacy = { appointments: ["home_collection_address", "collection_instructions", "communication_evidence_reference", "home_charge_reason"], appointment_services: ["service_name", "service_reference"], appointment_status_history: ["reason"], appointment_assignment_history: ["reason"], collection_job_events: ["reason", "evidence_reference"], specimens: ["specimen_type", "requirement_reference"], dispatch_batches: ["carrier_reference", "external_lab_reference"], sample_custody_events: ["evidence_reference", "reason"], sample_external_receipts: ["receipt_reference", "evidence_reference"], sample_exceptions: ["reason", "resolution_reference"] };
  for (const [table, names] of Object.entries(legacy)) for (const name of names) if (fields.has(`${table}.${name}`)) throw new Error(`Plaintext cutover retained ${table}.${name}.`);
  const afterCutover = await backfillOperationalData(options);
  if (afterCutover.processed !== 0) throw new Error("Post-cutover verification unexpectedly rewrote encrypted operational values.");
  const [original] = (await scoped.query("SELECT private_data_ciphertext FROM appointments WHERE id=$1", [ids.appointment])).rows;
  const parts = original.private_data_ciphertext.split("."); parts[3] = `${parts[3][0] === "A" ? "B" : "A"}${parts[3].slice(1)}`;
  await scoped.query("UPDATE appointments SET private_data_ciphertext=$1 WHERE id=$2", [parts.join("."), ids.appointment]);
  let tamperRejected = false;
  try { await backfillOperationalData(options); } catch { tamperRejected = true; }
  await scoped.query("UPDATE appointments SET private_data_ciphertext=$1 WHERE id=$2", [original.private_data_ciphertext, ids.appointment]);
  if (!tamperRejected) throw new Error("Tampered synthetic appointment ciphertext was not rejected.");
  const originalKeys = process.env.RUDRA_FIELD_ENCRYPTION_KEYS;
  process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ [process.env.RUDRA_FIELD_ACTIVE_KEY_ID]: Buffer.alloc(32, 7).toString("base64") });
  let wrongKeyRejected = false;
  try { await backfillOperationalData(options); } catch { wrongKeyRejected = true; }
  finally { process.env.RUDRA_FIELD_ENCRYPTION_KEYS = originalKeys; }
  if (!wrongKeyRejected) throw new Error("Wrong encryption key was not rejected after cutover.");
  const replay = await runMigrations(databaseUrl, null, schema);
  const { getMigrationFiles } = await import("./migrate.mjs");
  const migrationFiles = await getMigrationFiles();
  const cutoverIndex = migrationFiles.findIndex((file) => file.name === "0036_drop_plaintext_operational_sensitive.sql");
  const expectedReplayCount = migrationFiles.length - cutoverIndex - 1;
  if (cutoverIndex < 0 || replay.applied !== expectedReplayCount || replay.total !== migrationFiles.length) throw new Error("Disposable operational migration replay was not stable after cutover.");

  const originalKeyring = process.env.RUDRA_FIELD_ENCRYPTION_KEYS;
  const originalActiveKeyId = process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
  try {
    const keyring = JSON.parse(originalKeyring ?? "{}");
    const rotationKeyId = `synthetic_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    keyring[rotationKeyId] = randomBytes(32).toString("base64");
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify(keyring);
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = rotationKeyId;
    let rotationInterrupted = false;
    try { await rotateOperationalDataKey({ ...options, interruptAfterFirstBatch: true }); }
    catch (error) { rotationInterrupted = error instanceof Error && error.message === "synthetic_operational_key_rotation_interruption"; }
    if (!rotationInterrupted) throw new Error("Operational key-rotation interruption point was not exercised.");
    const resumedRotation = await rotateOperationalDataKey(options);
    if (resumedRotation.verified < 10 || resumedRotation.rotated < 9) throw new Error("Operational key rotation did not resume and rotate all populated synthetic records.");
    const repeatedRotation = await rotateOperationalDataKey(options);
    if (repeatedRotation.rotated !== 0 || repeatedRotation.verified < 10) throw new Error("Operational key rotation was not idempotent.");
    const rotatedRows = await scoped.query("SELECT id,organization_id,centre_id,private_data_ciphertext FROM appointments WHERE id=$1", [ids.appointment]);
    const rotatedAppointment = rotatedRows.rows[0];
    if (!rotatedAppointment.private_data_ciphertext.startsWith(`v1.${rotationKeyId}.`)) throw new Error("Operational appointment ciphertext was not re-encrypted to the active synthetic key.");
    const recovered = decryptOperationalEnvelope(rotatedAppointment.private_data_ciphertext, rotatedAppointment, "appointment", { keys: keyring });
    if (recovered.homeCollectionAddress?.line1 !== "Synthetic Road 1" || recovered.collectionInstructions !== "Synthetic collection instructions") throw new Error("Operational key rotation changed appointment private values.");
    const history = await scoped.query("SELECT id,organization_id,centre_id,private_data_ciphertext FROM sample_custody_events WHERE id=$1", [ids.custody]);
    if (!history.rows[0]?.private_data_ciphertext.startsWith(`v1.${rotationKeyId}.`)) throw new Error("Immutable custody ciphertext did not rotate.");
    const recoveredHistory = decryptOperationalEnvelope(history.rows[0].private_data_ciphertext, history.rows[0], "sample-custody-event", { keys: keyring });
    if (recoveredHistory.reason !== "Synthetic custody reason") throw new Error("Custody history changed during key rotation.");
    const rotatedTableIds = [["appointments", ids.appointment], ["appointment_services", ids.service], ["appointment_status_history", ids.appointmentHistory], ["appointment_assignment_history", ids.assignmentHistory], ["collection_job_events", ids.jobEvent], ["specimens", ids.specimen], ["dispatch_batches", ids.batch], ["sample_custody_events", ids.custody], ["sample_external_receipts", ids.receipt], ["sample_exceptions", ids.exception]];
    for (const [table, recordId] of rotatedTableIds) {
      const row = await scoped.query(`SELECT private_data_ciphertext FROM "${table}" WHERE id=$1`, [recordId]);
      if (!row.rows[0]?.private_data_ciphertext?.startsWith(`v1.${rotationKeyId}.`)) throw new Error(`Operational ciphertext rotation incomplete in ${table}.`);
    }
    let businessMutationRejected = false;
    try { await scoped.query("UPDATE sample_custody_events SET reason='altered' WHERE id=$1", [ids.custody]); }
    catch { businessMutationRejected = true; }
    if (!businessMutationRejected) throw new Error("Key-rotation guard allowed a mutation to immutable custody history.");
  } finally {
    if (originalKeyring === undefined) delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS;
    else process.env.RUDRA_FIELD_ENCRYPTION_KEYS = originalKeyring;
    if (originalActiveKeyId === undefined) delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
    else process.env.RUDRA_FIELD_ACTIVE_KEY_ID = originalActiveKeyId;
  }
  console.log("Populated synthetic operational qualification passed: backfill interruption/resume and plaintext cutover; migration replay; tamper/wrong-key rejection; interrupted key rotation/resume/idempotency across ten appointment and sample tables; encrypted values were preserved and immutable custody business fields remained protected.");
} finally {
  if (created) await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await scoped.end(); await pool.end();
}
