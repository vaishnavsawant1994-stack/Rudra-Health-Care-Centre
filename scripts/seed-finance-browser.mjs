import { createCipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import pg from "pg";
import { hashPassword } from "better-auth/crypto";

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_TEST_URL;
if (process.env.CI !== "true" || !databaseUrl) throw new Error("finance_browser_fixtures_require_github_ci_database");
const parsedDatabaseUrl = new URL(databaseUrl);
if (!["127.0.0.1", "localhost"].includes(parsedDatabaseUrl.hostname) || decodeURIComponent(parsedDatabaseUrl.pathname) !== "/rudra_health_test") {
  throw new Error("finance_browser_fixtures_refuse_non_disposable_database");
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, application_name: "rudra-finance-browser-fixtures" });
const ids = { organizationId: randomUUID(), authorizedCentreId: randomUUID(), readOnlyCentreId: randomUUID(), deniedCentreId: randomUUID(), staffId: randomUUID(), authUserId: randomUUID(), readRoleId: randomUUID(), createRoleId: randomUUID(), paymentRoleId: randomUUID(), reconcileRoleId: randomUUID(), closerStaffId: randomUUID(), closerAuthUserId: randomUUID(), closerReadRoleId: randomUUID(), closerReconcileRoleId: randomUUID() };
const patientKeyId = process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
const patientKey = Buffer.from(JSON.parse(process.env.RUDRA_FIELD_ENCRYPTION_KEYS ?? "{}")[patientKeyId] ?? "", "base64");
const blindIndexKey = Buffer.from(process.env.RUDRA_BLIND_INDEX_KEY ?? "", "base64");
if (!patientKeyId || patientKey.length !== 32 || blindIndexKey.length !== 32) throw new Error("finance_browser_test_keys_unavailable");

function encryptPatientField(value, field, context) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", patientKey, nonce);
  cipher.setAAD(Buffer.from(`rudra:patient-contact:v1:${context.organizationId}:${context.centreId}:${context.patientId}:${field}:${patientKeyId}`));
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `v1.${patientKeyId}.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}
function patientIndex(field, value) {
  const normalized = field === "email" ? value.trim().toLowerCase() : value.trim().replace(/[ ()-]/g, "");
  return createHmac("sha256", blindIndexKey).update(`rudra:patient-contact-index:v1:${field}:`).update(normalized).digest("hex");
}
function encryptOperational(value, recordType, recordId, centreId) {
  const keyId = process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
  const key = Buffer.from(JSON.parse(process.env.RUDRA_FIELD_ENCRYPTION_KEYS ?? "{}")[keyId] ?? "", "base64");
  if (!keyId || key.length !== 32) throw new Error("operational_encryption_key_unavailable");
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`rudra:operational-data:v1:${ids.organizationId}:${centreId}:${recordType}:${recordId}:${keyId}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1.${keyId}.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}
function nameIndex(kind, value) {
  const normalized = value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
  return createHmac("sha256", blindIndexKey).update(`rudra:patient-name-index:v1:${kind}:`).update(normalized).digest("hex");
}
function protect(value, field, context) { return encryptPatientField(value, field, context); }

async function createPatient(client, centreId, suffix) {
  const patientId = randomUUID();
  const context = { organizationId: ids.organizationId, centreId, patientId };
  const firstName = `Synthetic${suffix}`;
  const lastName = "BrowserFixture";
  await client.query(
    `INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,created_by_staff_id)
     VALUES($1,$2,$3,$4,'NOT_RECORDED',$5)`,
    [patientId, ids.organizationId, centreId, `SYN-${suffix}-${patientId.slice(0, 6)}`, ids.staffId],
  );
  const phone = `+1555${String(randomBytes(4).readUInt32BE() % 10000000).padStart(7, "0")}`;
  const nameCiphertext = encryptPatientField(JSON.stringify({ firstName, lastName }), "name", context);
  const profileCiphertext = protect(JSON.stringify({ preferredName: null, dateOfBirth: "1990-01-01", sexAtRegistration: "UNSPECIFIED", address: null }), "profile", context);
  await client.query(
    `INSERT INTO patient_contact_secrets(patient_id,organization_id,centre_id,encryption_key_id,phone_ciphertext,email_ciphertext,phone_blind_index,email_blind_index,profile_ciphertext,name_ciphertext,first_name_blind_index,last_name_blind_index,full_name_blind_index)
     VALUES($1,$2,$3,$4,$5,NULL,$6,NULL,$7,$8,$9,$10,$11)`,
    [patientId, ids.organizationId, centreId, patientKeyId, encryptPatientField(phone, "phone", context), patientIndex("phone", phone), profileCiphertext, nameCiphertext, nameIndex("first", firstName), nameIndex("last", lastName), nameIndex("full", `${firstName} ${lastName}`)],
  );
  return patientId;
}

async function createOrder(client, centreId, suffix, homeCharge) {
  const patientId = await createPatient(client, centreId, suffix);
  const appointmentId = randomUUID();
  const orderId = randomUUID();
  const now = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const isHome = Boolean(homeCharge);
  const privateDataCiphertext = encryptOperational({
    homeCollectionAddress: isHome ? { line1: "Synthetic test location", city: "Test City", state: "Test State", postalCode: "000000" } : null,
    collectionInstructions: null,
    communicationEvidenceReference: null,
    homeChargeReason: isHome ? homeCharge.reason ?? null : null,
  }, "appointment", appointmentId, centreId);
  await client.query(
    `INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,booking_source,visit_type,scheduled_at,time_zone,status,home_collection_window,home_charge_choice,home_charge_rupees,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash)
     VALUES($1,$2,$3,$4,$5,'STAFF',$6,$7,'Asia/Kolkata','REQUESTED',$8,$9,$10,$11,$12,$13,$14)`,
    [appointmentId, ids.organizationId, centreId, `SYN-AP-${suffix}-${appointmentId.slice(0, 6)}`, patientId, isHome ? "HOME_COLLECTION" : "CENTRE", now,
      isHome ? "Synthetic test window" : null,
      isHome ? homeCharge.choice : null, isHome ? homeCharge.rupees : null, privateDataCiphertext,
      ids.staffId, randomUUID(), randomBytes(32).toString("hex")],
  );
  const itemId = randomUUID();
  const versionId = randomUUID();
  const itemCode = `SYN-${suffix}`;
  await client.query(
    `INSERT INTO diagnostic_catalogue_items(id,organization_id,centre_id,service_type,service_code,current_version,created_by_staff_id)
     VALUES($1,$2,$3,'TEST',$4,1,$5)`, [itemId, ids.organizationId, centreId, itemCode, ids.staffId],
  );
  await client.query(
    `INSERT INTO diagnostic_catalogue_versions(id,organization_id,centre_id,catalogue_item_id,version_number,display_name,verification_status,price_amount,currency,price_source_reference,effective_from,source_type,created_by_staff_id)
     VALUES($1,$2,$3,$4,1,$5,'SYNTHETIC',450.00,'INR',$6,'2026-01-01','SYNTHETIC_TEST',$7)`, [versionId, ids.organizationId, centreId, itemId, `Synthetic test ${suffix}`, `TEST ONLY synthetic catalogue fixture ${versionId.slice(0, 8)}`, ids.staffId],
  );
  await client.query(
    `INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,currency,total_amount,created_by_staff_id)
     VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,'INR',450.00,$9)`,
    [orderId, ids.organizationId, centreId, `SYN-ORD-${suffix}-${orderId.slice(0, 6)}`, patientId, appointmentId, randomUUID(), randomBytes(32).toString("hex"), ids.staffId],
  );
  await client.query(
    `INSERT INTO diagnostic_order_items(id,organization_id,centre_id,order_id,catalogue_item_id,catalogue_version_id,service_type,service_code,display_name,verification_status,price_amount,currency,price_source_reference,effective_from,service_snapshot)
     VALUES($1,$2,$3,$4,$5,$6,'TEST',$7,$8,'SYNTHETIC',450.00,'INR',$9,'2026-01-01',$10::jsonb)`,
    [randomUUID(), ids.organizationId, centreId, orderId, itemId, versionId, itemCode, `Synthetic test ${suffix}`, `TEST ONLY synthetic catalogue fixture ${versionId.slice(0, 8)}`, JSON.stringify({ source: "browser_fixture", synthetic: true })],
  );
  const confirmedAt = new Date();
  await client.query(
    `UPDATE diagnostic_orders SET status='CONFIRMED',confirmed_by_staff_id=$2,confirmed_at=$3,version_number=version_number+1,updated_at=$3
     WHERE id=$1 AND status='DRAFT'`,
    [orderId, ids.staffId, confirmedAt],
  );
  await client.query(
    `INSERT INTO diagnostic_order_status_history(organization_id,centre_id,order_id,from_status,to_status,reason,version_number,actor_staff_id,recorded_at)
     VALUES($1,$2,$3,'DRAFT','CONFIRMED','Synthetic browser fixture: source-verified test catalogue item',2,$4,$5)`,
    [ids.organizationId, centreId, orderId, ids.staffId, confirmedAt],
  );
  return { orderId, appointmentId, catalogueItemId: itemId, catalogueVersionId: versionId };
}

try {
  const password = `Synthetic-CI-${randomBytes(24).toString("base64url")}!`;
  const email = `finance-browser-${randomUUID().slice(0, 8)}@invalid.test`;
  const closerPassword = `Synthetic-CI-${randomBytes(24).toString("base64url")}!`;
  const closerEmail = `finance-closer-${randomUUID().slice(0, 8)}@invalid.test`;
  const passwordHash = await hashPassword(password);
  const closerPasswordHash = await hashPassword(closerPassword);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [ids.organizationId, `CI-${ids.organizationId.slice(0, 8)}`, "Synthetic finance browser test"]);
    await client.query(
      "INSERT INTO centres(id,organization_id,code,name) VALUES($1,$2,$3,$4),($5,$2,$6,$7),($8,$2,$9,$10)",
      [ids.authorizedCentreId, ids.organizationId, `A-${ids.authorizedCentreId.slice(0, 6)}`, "Synthetic Finance Centre A", ids.readOnlyCentreId, `B-${ids.readOnlyCentreId.slice(0, 6)}`, "Synthetic Finance Centre B", ids.deniedCentreId, `C-${ids.deniedCentreId.slice(0, 6)}`, "Synthetic Finance Centre C"],
    );
    await client.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [ids.authUserId, "Synthetic Finance Operator", email]);
    await client.query('INSERT INTO "account"(id,"accountId","providerId","userId",password) VALUES($1,$2,\'credential\',$3,$4)', [randomUUID(), ids.authUserId, ids.authUserId, passwordHash]);
    await client.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status) VALUES($1,$2,$3,$4,$5,'ACTIVE')", [ids.staffId, ids.authUserId, ids.organizationId, `CI-${ids.staffId.slice(0, 8)}`, "Synthetic Finance Operator"]);
    await client.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [ids.closerAuthUserId, "Synthetic Finance Closer", closerEmail]);
    await client.query('INSERT INTO "account"(id,"accountId","providerId","userId",password) VALUES($1,$2,\'credential\',$3,$4)', [randomUUID(), ids.closerAuthUserId, ids.closerAuthUserId, closerPasswordHash]);
    await client.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status) VALUES($1,$2,$3,$4,$5,'ACTIVE')", [ids.closerStaffId, ids.closerAuthUserId, ids.organizationId, `CI-${ids.closerStaffId.slice(0, 8)}`, "Synthetic Finance Closer"]);
    await client.query("INSERT INTO roles(id,organization_id,key,name,scope) VALUES($1,$2,$3,'Synthetic finance read','CENTRE'),($4,$2,$5,'Synthetic finance charge creator','CENTRE'),($6,$2,$7,'Synthetic payment recorder','CENTRE'),($8,$2,$9,'Synthetic reconciliation operator','CENTRE'),($10,$2,$11,'Synthetic closer read','CENTRE'),($12,$2,$13,'Synthetic closer reconciliation','CENTRE')", [ids.readRoleId, ids.organizationId, `finance_read_${ids.staffId.slice(0, 8)}`, ids.createRoleId, `finance_create_${ids.staffId.slice(0, 8)}`, ids.paymentRoleId, `finance_payment_${ids.staffId.slice(0, 8)}`, ids.reconcileRoleId, `finance_reconcile_${ids.staffId.slice(0, 8)}`, ids.closerReadRoleId, `finance_read_${ids.closerStaffId.slice(0, 8)}`, ids.closerReconcileRoleId, `finance_reconcile_${ids.closerStaffId.slice(0, 8)}`]);
    await client.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key='finance.read' ON CONFLICT DO NOTHING", [ids.readRoleId]);
    await client.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key IN ('finance.charge.create','appointments.home_charge.manage') ON CONFLICT DO NOTHING", [ids.createRoleId]);
    await client.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key='finance.payment.record' ON CONFLICT DO NOTHING", [ids.paymentRoleId]);
    await client.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key='finance.reconcile' ON CONFLICT DO NOTHING", [ids.reconcileRoleId]);
    await client.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key='finance.read' ON CONFLICT DO NOTHING", [ids.closerReadRoleId]);
    await client.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key='finance.reconcile' ON CONFLICT DO NOTHING", [ids.closerReconcileRoleId]);
    await client.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4),($1,$2,$3,$5),($1,$2,$6,$4),($1,$2,$7,$4),($1,$2,$8,$4),($1,$9,$10,$4),($1,$9,$11,$4)", [ids.organizationId, ids.staffId, ids.readRoleId, ids.authorizedCentreId, ids.readOnlyCentreId, ids.createRoleId, ids.paymentRoleId, ids.reconcileRoleId, ids.closerStaffId, ids.closerReadRoleId, ids.closerReconcileRoleId]);
    const homeFeeFixtures = [
      ["75", 75, null], ["99", 99, null], ["150", 150, null], ["CUSTOM", 125, "Authorized synthetic custom fee"], ["WAIVED", 0, "Synthetic fee waiver test"], ["ZERO", 0, null],
    ];
    const orders = [];
    for (const [choice, rupees, reason] of homeFeeFixtures) {
      orders.push(await createOrder(client, ids.authorizedCentreId, choice, { choice, rupees, reason }));
    }
    const readOnlyOrder = await createOrder(client, ids.readOnlyCentreId, "READONLY", null);
    await client.query("COMMIT");

    const lines = {
      FINANCE_BROWSER_EMAIL: email,
      FINANCE_BROWSER_PASSWORD: password,
      FINANCE_BROWSER_CLOSER_EMAIL: closerEmail,
      FINANCE_BROWSER_CLOSER_PASSWORD: closerPassword,
      FINANCE_BROWSER_CENTRE_ID: ids.authorizedCentreId,
      FINANCE_BROWSER_READ_ONLY_CENTRE_ID: ids.readOnlyCentreId,
      FINANCE_BROWSER_DENIED_CENTRE_ID: ids.deniedCentreId,
      FINANCE_BROWSER_ORDER_IDS: JSON.stringify(orders.map((order) => order.orderId)),
      FINANCE_BROWSER_CATALOGUE_VERSION_IDS: JSON.stringify(orders.map((order) => order.catalogueVersionId)),
      FINANCE_BROWSER_CATALOGUE_ITEM_IDS: JSON.stringify(orders.map((order) => order.catalogueItemId)),
      FINANCE_BROWSER_READ_ONLY_ORDER_ID: readOnlyOrder.orderId,
      FINANCE_BROWSER_STAFF_ID: ids.staffId,
      FINANCE_BROWSER_CLOSER_STAFF_ID: ids.closerStaffId,
    };
    for (const [key, value] of Object.entries(lines)) {
      if (/[\r\n]/.test(value)) throw new Error(`invalid_fixture_output:${key}`);
      if (key.endsWith("PASSWORD")) process.stdout.write(`::add-mask::${value}\n`);
      appendFileSync(process.env.GITHUB_ENV, `${key}=${value}\n`);
    }
    process.stdout.write("Created isolated synthetic finance browser fixtures.\n");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
} finally {
  await pool.end();
}
