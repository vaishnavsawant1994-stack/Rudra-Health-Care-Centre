import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "./load-project-env.mjs";
import { getMigrationFiles, runMigrations } from "./migrate.mjs";
import { backfillFinanceReportData, decryptFinanceReportEnvelope, rotateFinanceReportDataKey } from "./encrypt-finance-report-data.mjs";

loadProjectEnvironment();
const { Pool } = pg;
const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required.");
const target = new URL(databaseUrl);
if (!/test/i.test(decodeURIComponent(target.pathname)) || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname) || decodeURIComponent(target.username) !== "rudra_test_runner") throw new Error("Refusing finance/report backfill qualification outside the local test-runner database.");

const schema = `p2_09a_finance_${randomUUID().replaceAll("-", "")}`;
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-finance-report-backfill-qualification" });
const scoped = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-finance-report-backfill-fixture", options: `-c search_path=${schema},public` });
let created = false;
const ids = Object.fromEntries(["org", "centre", "auth", "staff", "patient", "order", "report", "payment", "charge", "adjustment", "refund", "event", "reconciliation", "reportEvent", "delivery", "followup", "followupEvent"].map((key) => [key, randomUUID()]));
const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
const quiet = { log() {} };

try {
  await pool.query(`CREATE SCHEMA "${schema}"`); created = true;
  const namespaceCheck = await scoped.query("SELECT current_schema() AS schema");
  if (namespaceCheck.rows[0]?.schema !== schema) throw new Error("Finance/report fixture schema isolation could not be confirmed.");
  await runMigrations(databaseUrl, "0038_patient_consent_consistency.sql", schema);
  const client = await scoped.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [ids.org, `SYN-${seed}`, "Synthetic finance/report encryption qualification"]);
    await client.query("INSERT INTO centres(id,organization_id,code,name) VALUES($1,$2,$3,$4)", [ids.centre, ids.org, `SYN-${seed}`, "Synthetic centre"]);
    await client.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [ids.auth, "Synthetic staff", `${seed.toLowerCase()}@synthetic.invalid`]);
    await client.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status) VALUES($1,$2,$3,$4,$5,'ACTIVE')", [ids.staff, ids.auth, ids.org, `SYN-${seed}`, "Synthetic finance/report operator"]);
    await client.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,consent_recorded_at,consent_method,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',NULL,NULL,$5)", [ids.patient, ids.org, ids.centre, `SYN-P-${seed}`, ids.staff]);
    await client.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,status,idempotency_key,request_hash,total_amount,created_by_staff_id,confirmed_by_staff_id,confirmed_at) VALUES($1,$2,$3,$4,$5,'CONFIRMED',$6,$7,100.00,$8,$8,now())", [ids.order, ids.org, ids.centre, `SYN-O-${seed}`, ids.patient, randomUUID(), "a".repeat(64), ids.staff]);
    await client.query("INSERT INTO diagnostic_reports(id,organization_id,centre_id,patient_id,order_id,report_number,external_reference,hold_reason,source,status,uploader_staff_id) VALUES($1,$2,$3,$4,$5,$6,'SYNTHETIC-LAB-REF','Synthetic verification hold','METROPOLIS_REFERENCE','ON_HOLD',$7)", [ids.report, ids.org, ids.centre, ids.patient, ids.order, `SYN-R-${seed}`, ids.staff]);
    await client.query("INSERT INTO finance_charges(id,organization_id,centre_id,order_id,charge_type,charge_code,amount_minor,snapshot,recorded_by_staff_id,idempotency_key) VALUES($1,$2,$3,$4,'DIAGNOSTIC','SYNTHETIC',10000,'{}',$5,$6)", [ids.charge, ids.org, ids.centre, ids.order, ids.staff, randomUUID()]);
    await client.query("INSERT INTO finance_payments(id,organization_id,centre_id,payment_number,method,status,amount_minor,reference,received_by_staff_id,idempotency_key) VALUES($1,$2,$3,$4,'UPI','RECORDED',5000,'SYNTHETIC-PAYMENT-REF',$5,$6)", [ids.payment, ids.org, ids.centre, `SYN-P-${seed}`, ids.staff, randomUUID()]);
    await client.query("INSERT INTO finance_adjustments(id,organization_id,centre_id,charge_id,amount_minor,reason,approved_by_staff_id) VALUES($1,$2,$3,$4,100,'Synthetic adjustment reason',$5)", [ids.adjustment, ids.org, ids.centre, ids.charge, ids.staff]);
    await client.query("INSERT INTO finance_refunds(id,organization_id,centre_id,payment_id,amount_minor,reason,status,requested_by_staff_id) VALUES($1,$2,$3,$4,200,'Synthetic refund reason','REQUESTED',$5)", [ids.refund, ids.org, ids.centre, ids.payment, ids.staff]);
    await client.query("INSERT INTO finance_events(id,organization_id,centre_id,event_type,entity_type,entity_id,amount_minor,reason,evidence_reference,actor_staff_id) VALUES($1,$2,$3,'PAYMENT_RECORDED','payment',$4,5000,'Synthetic finance event','SYNTHETIC-EVENT-EVIDENCE',$5)", [ids.event, ids.org, ids.centre, ids.payment, ids.staff]);
    await client.query("INSERT INTO finance_reconciliations(id,organization_id,centre_id,status,opened_by_staff_id,closed_by_staff_id,opening_cash_minor,expected_cash_minor,counted_cash_minor,variance_minor,reason,closed_at) VALUES($1,$2,$3,'CLOSED',$4,$4,0,0,0,0,'Synthetic reconciliation evidence',now())", [ids.reconciliation, ids.org, ids.centre, ids.staff]);
    await client.query("INSERT INTO report_events(id,organization_id,centre_id,report_id,event_type,reason,evidence_reference,actor_staff_id) VALUES($1,$2,$3,$4,'REGISTERED','Synthetic report event','SYNTHETIC-REPORT-EVIDENCE',$5)", [ids.reportEvent, ids.org, ids.centre, ids.report, ids.staff]);
    await client.query("INSERT INTO report_deliveries(id,organization_id,centre_id,report_id,recipient_label,recipient_verification_reference,channel,outcome,evidence_reference,idempotency_key,actor_staff_id) VALUES($1,$2,$3,$4,'Synthetic recipient','SYNTHETIC-VERIFICATION','PHYSICAL_COLLECTION','ATTEMPTED','SYNTHETIC-DELIVERY-EVIDENCE',$5,$6)", [ids.delivery, ids.org, ids.centre, ids.report, randomUUID(), ids.staff]);
    await client.query("INSERT INTO report_followups(id,organization_id,centre_id,report_id,assigned_staff_id,task_type,idempotency_key,due_at,status,outcome,outcome_note,created_by_staff_id,completed_by_staff_id,completed_at) VALUES($1,$2,$3,$4,$5,'REPORT_PENDING',$6,now(),'COMPLETED','Synthetic outcome','Synthetic follow-up note',$5,$5,now())", [ids.followup, ids.org, ids.centre, ids.report, ids.staff, randomUUID()]);
    await client.query("INSERT INTO report_followup_events(id,organization_id,centre_id,followup_id,event_type,note,actor_staff_id) VALUES($1,$2,$3,$4,'NOTE','Synthetic follow-up history note',$5)", [ids.followupEvent, ids.org, ids.centre, ids.followup, ids.staff]);
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
  finally { client.release(); }

  const migration = (await getMigrationFiles()).find((file) => file.name === "0039_finance_report_private_encryption_prepare.sql");
  if (!migration) throw new Error("Finance/report prepare migration is missing.");
  const c = await scoped.connect();
  try {
    await c.query("BEGIN"); await c.query(migration.sql);
    await c.query("INSERT INTO app_schema_migrations(migration_name,checksum) VALUES($1,$2)", [migration.name, migration.checksum]); await c.query("COMMIT");
  } catch (error) { await c.query("ROLLBACK").catch(() => {}); throw error; }
  finally { c.release(); }

  let interrupted = false;
  try { await backfillFinanceReportData({ databaseUrl, schema, logger: quiet, interruptAfterFirstTable: true }); }
  catch (error) { interrupted = error instanceof Error && error.message === "synthetic_backfill_interruption"; }
  if (!interrupted) throw new Error("Finance/report synthetic interruption point was not exercised.");
  const resumed = await backfillFinanceReportData({ databaseUrl, schema, logger: quiet });
  if (resumed.processed < 9) throw new Error("Finance/report populated backfill did not resume its remaining rows.");

  const cfgKeys = JSON.parse(process.env.RUDRA_FIELD_ENCRYPTION_KEYS ?? "{}");
  const cfg = { keys: cfgKeys };
  const checks = [
    ["finance_payments", ids.payment, "finance-payment", { reference: "SYNTHETIC-PAYMENT-REF" }],
    ["finance_adjustments", ids.adjustment, "finance-adjustment", { reason: "Synthetic adjustment reason" }],
    ["finance_refunds", ids.refund, "finance-refund", { reason: "Synthetic refund reason", executionReference: null }],
    ["finance_events", ids.event, "finance-event", { reason: "Synthetic finance event", evidenceReference: "SYNTHETIC-EVENT-EVIDENCE" }],
    ["finance_reconciliations", ids.reconciliation, "finance-reconciliation", { reason: "Synthetic reconciliation evidence" }],
    ["diagnostic_reports", ids.report, "report-private", { externalReference: "SYNTHETIC-LAB-REF", holdReason: "Synthetic verification hold" }],
    ["report_events", ids.reportEvent, "report-event", { reason: "Synthetic report event", evidenceReference: "SYNTHETIC-REPORT-EVIDENCE" }],
    ["report_deliveries", ids.delivery, "report-delivery", { recipientLabel: "Synthetic recipient", recipientVerificationReference: "SYNTHETIC-VERIFICATION", evidenceReference: "SYNTHETIC-DELIVERY-EVIDENCE" }],
    ["report_followups", ids.followup, "report-followup", { outcome: "Synthetic outcome", outcomeNote: "Synthetic follow-up note" }],
    ["report_followup_events", ids.followupEvent, "report-followup-event", { note: "Synthetic follow-up history note" }],
  ];
  const verify = await scoped.connect();
  try {
    for (const [table, id, type, expected] of checks) {
      const { rows } = await verify.query(`SELECT id,organization_id,centre_id,private_data_ciphertext FROM "${table}" WHERE id=$1`, [id]);
      if (!rows[0]?.private_data_ciphertext) throw new Error(`Encrypted row missing in ${table}.`);
      const actual = decryptFinanceReportEnvelope(rows[0].private_data_ciphertext, rows[0], type, cfg);
      for (const [field, value] of Object.entries(expected)) if (actual[field] !== value) throw new Error(`Synthetic plaintext/ciphertext parity failed in ${table}.`);
    }
    const privateColumns = await verify.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1", [schema]);
    const columns = new Set(privateColumns.rows.map((row) => `${row.table_name}.${row.column_name}`));
    for (const [table, id, type] of checks) {
      const { rows } = await verify.query(`SELECT id,organization_id,centre_id,private_data_ciphertext FROM "${table}" WHERE id=$1`, [id]);
      const parts = rows[0].private_data_ciphertext.split("."); parts[3] = `${parts[3][0] === "A" ? "B" : "A"}${parts[3].slice(1)}`;
      let rejected = false; try { decryptFinanceReportEnvelope(parts.join("."), rows[0], type, cfg); } catch { rejected = true; }
      if (!rejected) throw new Error(`Tampered ciphertext was not rejected in ${table}.`);
    }
    if (!columns.has("finance_payments.reference") || !columns.has("report_events.reason")) throw new Error("Prepare migration removed a legacy field before cutover qualification.");
  } finally { verify.release(); }

  const replay = await runMigrations(databaseUrl, null, schema);
  const migrationFiles = await getMigrationFiles();
  const financePrepareIndex = migrationFiles.findIndex((file) => file.name === "0039_finance_report_private_encryption_prepare.sql");
  const expectedReplayCount = migrationFiles.length - (financePrepareIndex + 1);
  if (financePrepareIndex < 0 || replay.applied !== expectedReplayCount || replay.total !== migrationFiles.length) throw new Error("Finance/report migration replay or plaintext cutover was not stable.");
  const afterCutoverColumns = await scoped.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1", [schema]);
  const afterCutover = new Set(afterCutoverColumns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  const legacyFields = ["finance_payments.reference", "finance_adjustments.reason", "finance_refunds.reason", "finance_refunds.execution_reference", "finance_events.reason", "finance_events.evidence_reference", "finance_reconciliations.reason", "diagnostic_reports.external_reference", "diagnostic_reports.hold_reason", "report_events.reason", "report_events.evidence_reference", "report_deliveries.recipient_label", "report_deliveries.recipient_verification_reference", "report_deliveries.evidence_reference", "report_followups.outcome", "report_followups.outcome_note", "report_followup_events.note"];
  for (const field of legacyFields) if (afterCutover.has(field)) throw new Error(`Plaintext cutover retained ${field}.`);
  const postCutover = await backfillFinanceReportData({ databaseUrl, schema, logger: quiet });
  if (postCutover.processed !== 0) throw new Error("Post-cutover backfill unexpectedly rewrote encrypted data.");

  const oldKeyring = process.env.RUDRA_FIELD_ENCRYPTION_KEYS;
  const oldActiveKeyId = process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
  try {
    const keyring = JSON.parse(oldKeyring ?? "{}");
    const rotationKeyId = `synthetic_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
    keyring[rotationKeyId] = randomBytes(32).toString("base64");
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify(keyring);
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = rotationKeyId;

    let rotationInterrupted = false;
    try { await rotateFinanceReportDataKey({ databaseUrl, schema, logger: quiet, interruptAfterFirstBatch: true }); }
    catch (error) { rotationInterrupted = error instanceof Error && error.message === "synthetic_key_rotation_interruption"; }
    if (!rotationInterrupted) throw new Error("Finance/report key-rotation interruption point was not exercised.");

    const rotated = await rotateFinanceReportDataKey({ databaseUrl, schema, logger: quiet });
    if (rotated.verified < checks.length) throw new Error(`Finance/report key rotation did not resume and verify every populated row (${rotated.verified} verified, ${checks.length} expected).`);
    const repeated = await rotateFinanceReportDataKey({ databaseUrl, schema, logger: quiet });
    if (repeated.rotated !== 0 || repeated.verified < 10) throw new Error("Finance/report key rotation was not idempotent.");

    const rotatedCfg = { keys: keyring };
    const verifyRotation = await scoped.connect();
    try {
      for (const [table, id, type, expected] of checks) {
        const { rows } = await verifyRotation.query(`SELECT id,organization_id,centre_id,private_data_ciphertext FROM "${table}" WHERE id=$1`, [id]);
        if (!rows[0]?.private_data_ciphertext?.startsWith(`v1.${rotationKeyId}.`)) throw new Error(`Key rotation left an old key envelope in ${table}.`);
        const actual = decryptFinanceReportEnvelope(rows[0].private_data_ciphertext, rows[0], type, rotatedCfg);
        for (const [field, value] of Object.entries(expected)) if (actual[field] !== value) throw new Error(`Finance/report values changed during key rotation in ${table}.`);
      }
      await verifyRotation.query("BEGIN");
      await verifyRotation.query("SELECT set_config('rudra.finance_report_key_rotation','on',true)");
      let protectedFieldsRejected = false;
      try { await verifyRotation.query("UPDATE finance_events SET amount_minor=amount_minor+1 WHERE id=$1", [ids.event]); }
      catch { protectedFieldsRejected = true; }
      await verifyRotation.query("ROLLBACK");
      if (!protectedFieldsRejected) throw new Error("The rotation guard permitted a business-field change on append-only financial history.");
    } finally { verifyRotation.release(); }
  } finally {
    if (oldKeyring === undefined) delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS;
    else process.env.RUDRA_FIELD_ENCRYPTION_KEYS = oldKeyring;
    if (oldActiveKeyId === undefined) delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
    else process.env.RUDRA_FIELD_ACTIVE_KEY_ID = oldActiveKeyId;
  }
  console.log("Populated synthetic finance/report qualification passed: interrupted backfill resumed; values and relations matched; tampering was rejected; migration 0040 removed plaintext fields; post-cutover replay passed; interrupted key rotation resumed, preserved decrypted values, and was idempotent in the disposable schema.");
} finally {
  if (created) await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => {});
  await scoped.end(); await pool.end();
}
