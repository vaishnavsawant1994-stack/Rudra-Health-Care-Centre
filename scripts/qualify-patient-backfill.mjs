import { randomBytes, randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "./load-project-env.mjs";
import { getMigrationFiles, runMigrations } from "./migrate.mjs";
import { backfillPatientContacts } from "./encrypt-patient-contacts.mjs";
import { backfillPatientProfile } from "./encrypt-patient-profile.mjs";
import { backfillPatientNames } from "./encrypt-patient-names.mjs";
import { backfillFamilyData } from "./encrypt-family-data.mjs";
import { backfillLeadData } from "./encrypt-lead-data.mjs";
import { decryptPatientRotationValue, rotatePatientDataKey } from "./rotate-patient-data-key.mjs";
import { rotateFamilyLeadDataKey } from "./rotate-family-lead-data-key.mjs";

loadProjectEnvironment();
const { Pool } = pg;
const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl) throw new Error("DATABASE_TEST_URL is required for disposable patient backfill qualification.");
const target = new URL(databaseUrl);
if (!decodeURIComponent(target.pathname).toLowerCase().includes("test")) throw new Error("Refusing backfill qualification outside the dedicated test database.");
if (!['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname) || decodeURIComponent(target.username) !== "rudra_test_runner") throw new Error("Patient backfill qualification requires the local rudra_test_runner connection.");

const schema = `p2_09a_${randomUUID().replaceAll("-", "")}`;
const schemaPath = `-c search_path=${schema},public`;
const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-patient-backfill-qualification" });
const checkPool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-patient-backfill-tamper-check", options: schemaPath });
let schemaCreated = false;
const quiet = { log() {} };

try {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  const prefixMigration = "0024_clean_report_requires_encryption_key.sql";
  await runMigrations(databaseUrl, prefixMigration, schema);

  const client = await pool.connect();
  const orgId = randomUUID();
  const centreId = randomUUID();
  const staffId = randomUUID();
  const authUserId = `synthetic-${randomUUID()}`;
  const patientOneId = randomUUID();
  const patientTwoId = randomUUID();
  const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const synthetic = [
    { id: patientOneId, number: `SYN-P-${seed}-1`, first: "Synthetic", last: "One", phone: "+919876543201", email: "one@synthetic.invalid", preferred: "S. One", dob: "1990-01-02", sex: "UNSPECIFIED", address: { city: "Synthetic City", postalCode: "000001" } },
    { id: patientTwoId, number: `SYN-P-${seed}-2`, first: "Synthetic", last: "Two", phone: "+919876543202", email: null, preferred: null, dob: "1988-03-04", sex: null, address: null },
  ];
  try {
    await client.query(`SET search_path TO "${schema}", public`);
    await client.query("BEGIN");
    await client.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,'Synthetic encryption qualification')", [orgId, `SYN-${seed}`]);
    await client.query("INSERT INTO centres(id,organization_id,code,name) VALUES($1,$2,$3,'Synthetic test centre')", [centreId, orgId, `SYN-${seed}`]);
    await client.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authUserId, "Synthetic Staff", `${seed.toLowerCase()}@synthetic.invalid`]);
    await client.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status) VALUES($1,$2,$3,$4,'Synthetic Staff','ACTIVE')", [staffId, authUserId, orgId, `SYN-${seed}`]);
    for (const person of synthetic) {
      await client.query(`INSERT INTO patients(id,organization_id,centre_id,patient_number,first_name,last_name,preferred_name,date_of_birth,sex_at_registration,phone,email,address,consent_status,consent_recorded_at,consent_method,created_by_staff_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,'GRANTED',now(),'IN_PERSON',$13)`, [person.id, orgId, centreId, person.number, person.first, person.last, person.preferred, person.dob, person.sex, person.phone, person.email, JSON.stringify(person.address), staffId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  await runMigrations(databaseUrl, "0025_patient_contact_encryption.sql", schema);
  const backfillOptions = { databaseUrl, schema, logger: quiet };
  const contactsFirst = await backfillPatientContacts(backfillOptions);
  await checkPool.query("DELETE FROM patient_contact_secrets WHERE patient_id=$1", [patientTwoId]);
  const contactsReplay = await backfillPatientContacts(backfillOptions);
  if (contactsFirst.total !== 2 || contactsFirst.processed !== 2 || contactsReplay.total !== 2 || contactsReplay.processed !== 1) throw new Error("Populated synthetic contact backfill did not resume an interrupted partial batch.");
  await runMigrations(databaseUrl, "0026_drop_plaintext_patient_contacts.sql", schema);
  await runMigrations(databaseUrl, "0027_patient_profile_encryption.sql", schema);
  const profilesFirst = await backfillPatientProfile(backfillOptions);
  await checkPool.query("UPDATE patient_contact_secrets SET profile_ciphertext=NULL WHERE patient_id=$1", [patientTwoId]);
  const profilesReplay = await backfillPatientProfile(backfillOptions);
  if (profilesFirst.total !== 2 || profilesFirst.processed !== 2 || profilesReplay.total !== 2 || profilesReplay.processed !== 1) throw new Error("Populated synthetic profile backfill did not resume an interrupted partial batch.");
  await runMigrations(databaseUrl, "0028_drop_plaintext_patient_profile.sql", schema);
  await runMigrations(databaseUrl, "0029_patient_name_encryption_prepare.sql", schema);
  const namesFirst = await backfillPatientNames(backfillOptions);
  await checkPool.query("UPDATE patient_contact_secrets SET name_ciphertext=NULL,first_name_blind_index=NULL,last_name_blind_index=NULL,full_name_blind_index=NULL WHERE patient_id=$1", [patientTwoId]);
  const namesReplay = await backfillPatientNames(backfillOptions);
  if (namesFirst.total !== 2 || namesFirst.processed !== 2 || namesReplay.total !== 2 || namesReplay.processed !== 1) throw new Error("Populated synthetic patient name backfill did not resume an interrupted partial batch.");
  await runMigrations(databaseUrl, "0030_drop_plaintext_patient_names.sql", schema);
  await runMigrations(databaseUrl, "0031_family_sensitive_encryption_prepare.sql", schema);
  const familyId = randomUUID(); const memberOne = randomUUID(); const memberTwo = randomUUID(); const grantId = randomUUID(); const arrangementId = randomUUID();
  await checkPool.query("INSERT INTO families(id,organization_id,centre_id,family_number,display_name,created_by_staff_id) VALUES($1,$2,$3,$4,'Synthetic encryption family',$5)",[familyId,orgId,centreId,`SYN-F-${seed}`,staffId]);
  await checkPool.query("INSERT INTO family_members(id,organization_id,centre_id,family_id,patient_id,relationship,status,authorization_basis,evidence_reference,verified_by_staff_id,verified_at,created_by_staff_id) VALUES($1,$2,$3,$4,$5,'SELF','ACTIVE','PATIENT_SELF','SYNTHETIC-RELATIONSHIP-EVIDENCE',$6,now(),$6),($7,$2,$3,$4,$8,'SIBLING','ACTIVE','PATIENT_SELF','SYNTHETIC-MEMBER-EVIDENCE',$6,now(),$6)",[memberOne,orgId,centreId,familyId,patientOneId,staffId,memberTwo,patientTwoId]);
  await checkPool.query("INSERT INTO family_access_grants(id,organization_id,centre_id,family_id,patient_id,grantee_patient_id,allowed_data,purpose,authorization_basis,status,evidence_reference,created_by_staff_id,verified_by_staff_id,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,'Synthetic sharing purpose','PATIENT_SELF','ACTIVE','SYNTHETIC-SHARING-EVIDENCE',$8,$8,now())",[grantId,orgId,centreId,familyId,patientOneId,patientTwoId,JSON.stringify(["APPOINTMENTS"]),staffId]);
  await checkPool.query("INSERT INTO family_contact_arrangements(id,organization_id,centre_id,family_id,patient_id,channel,purpose,status,authorization_basis,evidence_reference,created_by_staff_id,verified_by_staff_id,verified_at) VALUES($1,$2,$3,$4,$5,'PHONE','GENERAL_FAMILY_CONTACT','VERIFIED','PATIENT_SELF','SYNTHETIC-CONTACT-EVIDENCE',$6,$6,now())",[arrangementId,orgId,centreId,familyId,patientOneId,staffId]);
  const familyFirst = await backfillFamilyData(backfillOptions);
  await checkPool.query("UPDATE family_members SET evidence_ciphertext=NULL WHERE id=$1",[memberTwo]);
  const familyReplay = await backfillFamilyData(backfillOptions);
  if (familyFirst.total !== 1 || familyFirst.processed < 4 || familyReplay.total !== 1 || familyReplay.processed !== 1) throw new Error("Populated synthetic family backfill did not resume an interrupted field batch.");
  await runMigrations(databaseUrl, "0032_drop_plaintext_family_sensitive.sql", schema);
  const familyColumns = await checkPool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND ((table_name='families' AND column_name='display_name') OR (table_name='family_members' AND column_name='evidence_reference') OR (table_name='family_access_grants' AND column_name IN ('purpose','evidence_reference')) OR (table_name='family_contact_arrangements' AND column_name='evidence_reference'))",[schema]);
  if (familyColumns.rowCount) throw new Error("Sensitive family plaintext columns remain after cutover.");
  const familyAfterCutover = await backfillFamilyData(backfillOptions);
  if (familyAfterCutover.total !== 1) throw new Error("Post-cutover family ciphertext verification failed.");

  await runMigrations(databaseUrl, "0033_lead_sensitive_encryption_prepare.sql", schema);
  const leadId = randomUUID(); const leadActivityId = randomUUID(); const followupId = randomUUID(); const conversionId = randomUUID();
  await checkPool.query("INSERT INTO leads(id,organization_id,centre_id,lead_number,first_name,last_name,phone,email,enquiry_category,interested_service,source,campaign,status,priority,assigned_staff_id,preferred_channel,contact_permission,contact_evidence_reference,contact_permission_recorded_by,contact_permission_recorded_at,marketing_consent,marketing_evidence_reference,marketing_consent_recorded_by,marketing_consent_recorded_at,created_by_staff_id) VALUES($1,$2,$3,$4,'Synthetic','Lead','+919876543299','lead@synthetic.invalid','TEST','Synthetic panel','REFERRAL','Synthetic campaign','QUALIFIED','NORMAL',$5,'PHONE','AUTHORIZED','SYNTHETIC-CONTACT-EVIDENCE',$5,now(),'GRANTED','SYNTHETIC-MARKETING-EVIDENCE',$5,now(),$5)",[leadId,orgId,centreId,`SYN-L-${seed}`,staffId]);
  await checkPool.query("UPDATE leads SET lost_reason='Synthetic lost reason' WHERE id=$1",[leadId]);
  await checkPool.query("INSERT INTO lead_activities(id,organization_id,centre_id,lead_id,actor_staff_id,activity_type,body,metadata) VALUES($1,$2,$3,$4,$5,'NOTE','Synthetic private CRM note',jsonb_build_object('synthetic_detail','Synthetic activity metadata'))",[leadActivityId,orgId,centreId,leadId,staffId]);
  await checkPool.query("INSERT INTO lead_followups(id,organization_id,centre_id,lead_id,assigned_staff_id,due_at,task_type,status,outcome,outcome_note,created_by_staff_id,completed_by_staff_id,completed_at) VALUES($1,$2,$3,$4,$5,now(),'ADMINISTRATIVE','COMPLETED','OTHER','Synthetic follow-up outcome',$5,$5,now())",[followupId,orgId,centreId,leadId,staffId]);
  await checkPool.query("INSERT INTO lead_conversions(id,organization_id,centre_id,lead_id,patient_id,conversion_mode,identity_evidence_reference,converted_by_staff_id) VALUES($1,$2,$3,$4,$5,'EXISTING','SYNTHETIC-IDENTITY-EVIDENCE',$6)",[conversionId,orgId,centreId,leadId,patientOneId,staffId]);
  let leadBackfillInterrupted=false;
  try{await backfillLeadData({...backfillOptions,interruptAfterFirstBatch:true});}catch(error){leadBackfillInterrupted=error instanceof Error&&error.message==="synthetic_backfill_interruption";}
  if(!leadBackfillInterrupted)throw new Error("Synthetic lead backfill interruption was not observed safely.");
  const leadBackfillReplay=await backfillLeadData(backfillOptions);
  if(leadBackfillReplay.leads!==1||leadBackfillReplay.activities!==1||leadBackfillReplay.processed<3)throw new Error("Interrupted synthetic lead/CRM backfill did not resume idempotently.");
  await runMigrations(databaseUrl,"0034_drop_plaintext_lead_sensitive.sql",schema);
  const leadColumns=await checkPool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND ((table_name='leads' AND column_name IN ('first_name','last_name','phone','email','interested_service','campaign','contact_evidence_reference','marketing_evidence_reference','lost_reason')) OR (table_name='lead_activities' AND column_name IN ('body','metadata')) OR (table_name='lead_followups' AND column_name='outcome_note') OR (table_name='lead_conversions' AND column_name='identity_evidence_reference'))",[schema]);
  if(leadColumns.rowCount)throw new Error("Sensitive lead/CRM plaintext columns remain after cutover.");
  const leadAfterCutover=await backfillLeadData(backfillOptions);
  if(leadAfterCutover.leads!==1||leadAfterCutover.activities!==1)throw new Error("Post-cutover lead/CRM decrypt and blind-index verification failed.");
  const leadIdempotentReplay=await backfillLeadData(backfillOptions);
  if(leadIdempotentReplay.processed!==0)throw new Error("Lead backfill replay unexpectedly rewrote immutable data.");
  const blindIndex=await checkPool.query("SELECT phone_blind_index,email_blind_index,payload_ciphertext FROM lead_private_data WHERE lead_id=$1",[leadId]);
  if(!blindIndex.rows[0]?.phone_blind_index||!blindIndex.rows[0]?.email_blind_index||blindIndex.rows[0].payload_ciphertext.includes("Synthetic"))throw new Error("Lead phone/email exact-match index or ciphertext verification failed.");

  const columns = await checkPool.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='patients'", [schema]);
  const remaining = new Set(columns.rows.map((row) => `${row.table_name}.${row.column_name}`));
  for (const field of ["phone", "email", "preferred_name", "date_of_birth", "sex_at_registration", "address"]) if (remaining.has(`patients.${field}`)) throw new Error(`Patient plaintext cutover retained ${field}.`);
  if (remaining.has("patients.first_name") || remaining.has("patients.last_name")) throw new Error("Patient plaintext names remain after cutover.");

  const beforeTamper = await checkPool.query("SELECT patient_id,profile_ciphertext FROM patient_contact_secrets WHERE patient_id=$1", [patientOneId]);
  const originalProfile = beforeTamper.rows[0].profile_ciphertext;
  const profileParts = originalProfile.split("."); profileParts[3] = `${profileParts[3][0] === "A" ? "B" : "A"}${profileParts[3].slice(1)}`; const tampered = profileParts.join(".");
  await checkPool.query("UPDATE patient_contact_secrets SET profile_ciphertext=$1 WHERE patient_id=$2", [tampered, patientOneId]);
  let tamperRejected = false;
  try { await backfillPatientProfile(backfillOptions); } catch { tamperRejected = true; }
  await checkPool.query("UPDATE patient_contact_secrets SET profile_ciphertext=$1 WHERE patient_id=$2", [originalProfile, patientOneId]);
  if (!tamperRejected) throw new Error("Tampered synthetic profile ciphertext was not rejected.");

  const contactsAfterCutover = await backfillPatientContacts(backfillOptions);
  const profilesAfterCutover = await backfillPatientProfile(backfillOptions);
  const namesAfterCutover = await backfillPatientNames(backfillOptions);
  if (contactsAfterCutover.total !== 2 || profilesAfterCutover.total !== 2 || namesAfterCutover.total !== 2) throw new Error("Post-cutover decryption and blind-index integrity verification failed.");
  const rotationRowsBefore = await checkPool.query("SELECT patient_id,encryption_key_id,phone_blind_index,email_blind_index,first_name_blind_index,last_name_blind_index,full_name_blind_index FROM patient_contact_secrets ORDER BY patient_id");
  let familyLeadReplayKeyRing;
  let familyLeadReplayKeyId;
  const oldKeyId = process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
  const oldKeyRing = process.env.RUDRA_FIELD_ENCRYPTION_KEYS;
  const replacementKeyId = `synthetic_rotation_${seed.toLowerCase()}`;
  try {
    const replacementKeyRing = { ...JSON.parse(oldKeyRing ?? "{}"), [replacementKeyId]: randomBytes(32).toString("base64") };
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify(replacementKeyRing);
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = replacementKeyId;
    const rotationOptions = { databaseUrl, schema, logger: quiet, batchSize: 1 };
    const tamperTargetId = rotationRowsBefore.rows[0]?.patient_id;
    const tamperOriginal = (await checkPool.query("SELECT phone_ciphertext FROM patient_contact_secrets WHERE patient_id=$1", [tamperTargetId])).rows[0]?.phone_ciphertext;
    const tamperParts = tamperOriginal.split("."); tamperParts[3] = `${tamperParts[3][0] === "A" ? "B" : "A"}${tamperParts[3].slice(1)}`;
    await checkPool.query("UPDATE patient_contact_secrets SET phone_ciphertext=$1 WHERE patient_id=$2", [tamperParts.join("."), tamperTargetId]);
    let tamperRejected = false;
    try { await rotatePatientDataKey(rotationOptions); } catch (error) { tamperRejected = error instanceof Error && error.message === "Patient encryption integrity verification failed."; }
    await checkPool.query("UPDATE patient_contact_secrets SET phone_ciphertext=$1 WHERE patient_id=$2", [tamperOriginal, tamperTargetId]);
    if (!tamperRejected) throw new Error("Patient key rotation did not reject tampered ciphertext.");
    const missingOldKeyRing = { ...replacementKeyRing };
    delete missingOldKeyRing[oldKeyId ?? ""];
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify(missingOldKeyRing);
    let missingKeyRejected = false;
    try { await rotatePatientDataKey(rotationOptions); } catch (error) { missingKeyRejected = error instanceof Error && error.message === "Historical patient encryption key unavailable."; }
    if (!missingKeyRejected) throw new Error("Patient key rotation did not fail closed when the historical key was unavailable.");
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify(replacementKeyRing);
    let rotationInterrupted = false;
    try { await rotatePatientDataKey({ ...rotationOptions, interruptAfterFirstBatch: true }); } catch (error) { rotationInterrupted = error instanceof Error && error.message === "synthetic_patient_key_rotation_interruption"; }
    if (!rotationInterrupted) throw new Error("Patient key rotation interruption was not observed after a committed batch.");
    const afterInterrupt = await checkPool.query("SELECT count(*)::integer AS count FROM patient_contact_secrets WHERE encryption_key_id=$1", [replacementKeyId]);
    if (afterInterrupt.rows[0]?.count !== 1) throw new Error("Patient key rotation did not commit exactly one synthetic record before interruption.");
    const rotationResume = await rotatePatientDataKey(rotationOptions);
    const rotationReplay = await rotatePatientDataKey(rotationOptions);
    if (rotationResume.verified !== 2 || rotationResume.rotated !== 1 || rotationReplay.verified !== 2 || rotationReplay.rotated !== 0) throw new Error("Patient key rotation did not resume and replay idempotently.");
    const rotatedRows = await checkPool.query("SELECT patient_id,organization_id,centre_id,encryption_key_id,phone_ciphertext,email_ciphertext,profile_ciphertext,name_ciphertext,phone_blind_index,email_blind_index,first_name_blind_index,last_name_blind_index,full_name_blind_index FROM patient_contact_secrets ORDER BY patient_id");
    for (const [index, row] of rotatedRows.rows.entries()) {
      const contextRow = { ...row, id: row.patient_id };
      const expected = synthetic.find((person) => person.id === row.patient_id);
      const contact = decryptPatientRotationValue(row.phone_ciphertext, "phone", contextRow, { keys: replacementKeyRing, activeId: replacementKeyId });
      const email = row.email_ciphertext === null ? null : decryptPatientRotationValue(row.email_ciphertext, "email", contextRow, { keys: replacementKeyRing, activeId: replacementKeyId });
      const profile = decryptPatientRotationValue(row.profile_ciphertext, "profile", contextRow, { keys: replacementKeyRing, activeId: replacementKeyId });
      const name = decryptPatientRotationValue(row.name_ciphertext, "name", contextRow, { keys: replacementKeyRing, activeId: replacementKeyId });
      if (!expected || row.encryption_key_id !== replacementKeyId || contact !== expected.phone || email !== expected.email || profile.dateOfBirth !== expected.dob || profile.preferredName !== expected.preferred || profile.sexAtRegistration !== expected.sex || profile.address?.city !== expected.address?.city || name.firstName !== expected.first || name.lastName !== expected.last) throw new Error("Patient key rotation changed synthetic patient data.");
      const before = rotationRowsBefore.rows.find((candidate) => candidate.patient_id === row.patient_id);
      if (!before || ["phone_blind_index", "email_blind_index", "first_name_blind_index", "last_name_blind_index", "full_name_blind_index"].some((field) => row[field] !== before[field])) throw new Error("Patient key rotation changed a blind index.");
      if (index > 1) throw new Error("Patient rotation qualification unexpectedly returned extra records.");
    }
  } finally {
    if (oldKeyRing === undefined) delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; else process.env.RUDRA_FIELD_ENCRYPTION_KEYS = oldKeyRing;
    if (oldKeyId === undefined) delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; else process.env.RUDRA_FIELD_ACTIVE_KEY_ID = oldKeyId;
  }
  // Qualify the shared family/CRM field-key ring in this disposable populated schema.
  // The additive guard migration preserves append-only lead history for the runtime role.
  await runMigrations(databaseUrl, "0090_lead_history_key_rotation_guard.sql", schema);
  const familyLeadKeyId = process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
  const familyLeadKeyRing = process.env.RUDRA_FIELD_ENCRYPTION_KEYS;
  const familyLeadReplacementKeyId = `synthetic_family_lead_${seed.toLowerCase()}`;
  try {
    const familyLeadReplacementKeyRing = { ...JSON.parse(familyLeadKeyRing ?? "{}"), [familyLeadReplacementKeyId]: randomBytes(32).toString("base64") };
    familyLeadReplayKeyRing = JSON.stringify(familyLeadReplacementKeyRing);
    familyLeadReplayKeyId = familyLeadReplacementKeyId;
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify(familyLeadReplacementKeyRing);
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = familyLeadReplacementKeyId;
    const indexesBefore = await checkPool.query(`
      SELECT 'family' AS kind, id::text AS record_id, display_name_blind_index AS first_index, NULL::text AS second_index FROM families WHERE id=$1
      UNION ALL SELECT 'lead', lead_id::text, phone_blind_index, email_blind_index FROM lead_private_data WHERE lead_id=$2`, [familyId, leadId]);
    const familyTamperTarget = (await checkPool.query("SELECT id,evidence_ciphertext FROM family_members WHERE id=$1", [memberOne])).rows[0];
    const familyTamperParts = familyTamperTarget.evidence_ciphertext.split(".");
    familyTamperParts[3] = `${familyTamperParts[3][0] === "A" ? "B" : "A"}${familyTamperParts[3].slice(1)}`;
    await checkPool.query("UPDATE family_members SET evidence_ciphertext=$1 WHERE id=$2", [familyTamperParts.join("."), memberOne]);
    let familyTamperRejected = false;
    try { await rotateFamilyLeadDataKey({ databaseUrl, schema, logger: quiet, batchSize: 1 }); }
    catch (error) { familyTamperRejected = error instanceof Error && error.message === "Family/lead encryption integrity verification failed."; }
    await checkPool.query("UPDATE family_members SET evidence_ciphertext=$1 WHERE id=$2", [familyTamperTarget.evidence_ciphertext, memberOne]);
    if (!familyTamperRejected) throw new Error("Family/lead key rotation did not reject tampered ciphertext.");
    const familyHistoricalKeyId = familyTamperTarget.evidence_ciphertext.split(".")[1];
    const familyMissingKeyRing = { [familyLeadReplacementKeyId]: familyLeadReplacementKeyRing[familyLeadReplacementKeyId] };
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify(familyMissingKeyRing);
    let familyMissingKeyRejected = false;
    try { await rotateFamilyLeadDataKey({ databaseUrl, schema, logger: quiet, batchSize: 1 }); }
    catch (error) { familyMissingKeyRejected = error instanceof Error && error.message === "Historical family/lead encryption key unavailable."; }
    if (!familyMissingKeyRejected || !familyHistoricalKeyId) throw new Error("Family/lead key rotation did not fail closed when a historical key was unavailable.");
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify(familyLeadReplacementKeyRing);
    let familyLeadInterrupted = false;
    try { await rotateFamilyLeadDataKey({ databaseUrl, schema, logger: quiet, batchSize: 1, interruptAfterFirstBatch: true }); }
    catch (error) { familyLeadInterrupted = error instanceof Error && error.message === "synthetic_family_lead_key_rotation_interruption"; }
    if (!familyLeadInterrupted) throw new Error("Family/lead key rotation interruption was not observed after a committed batch.");
    const firstBatch = await checkPool.query("SELECT count(*)::integer AS count FROM families WHERE display_name_ciphertext LIKE $1", [`v1.${familyLeadReplacementKeyId}.%`]);
    if (firstBatch.rows[0]?.count !== 1) throw new Error("Family/lead key rotation did not commit the first synthetic row before interruption.");
    const familyLeadResume = await rotateFamilyLeadDataKey({ databaseUrl, schema, logger: quiet, batchSize: 1 });
    const familyLeadReplay = await rotateFamilyLeadDataKey({ databaseUrl, schema, logger: quiet, batchSize: 1 });
    if (familyLeadResume.verified < 10 || familyLeadResume.rotated < 1 || familyLeadReplay.verified !== familyLeadResume.verified || familyLeadReplay.rotated !== 0) throw new Error("Family/lead key rotation did not resume and replay idempotently across populated records.");
    const encryptedFields = await checkPool.query(`
      SELECT count(*)::integer AS total,
             count(*) FILTER (WHERE ciphertext LIKE $1)::integer AS active
      FROM (
        SELECT display_name_ciphertext AS ciphertext FROM families WHERE id=$2
        UNION ALL SELECT evidence_ciphertext FROM family_members WHERE family_id=$2
        UNION ALL SELECT purpose_ciphertext FROM family_access_grants WHERE family_id=$2
        UNION ALL SELECT evidence_ciphertext FROM family_access_grants WHERE family_id=$2
        UNION ALL SELECT evidence_ciphertext FROM family_contact_arrangements WHERE family_id=$2
        UNION ALL SELECT payload_ciphertext FROM lead_private_data WHERE lead_id=$3
        UNION ALL SELECT private_payload_ciphertext FROM lead_activities WHERE lead_id=$3
        UNION ALL SELECT outcome_note_ciphertext FROM lead_followups WHERE lead_id=$3
        UNION ALL SELECT identity_evidence_ciphertext FROM lead_conversions WHERE lead_id=$3
      ) encrypted`, [`v1.${familyLeadReplacementKeyId}.%`, familyId, leadId]);
    if (encryptedFields.rows[0]?.total !== 10 || encryptedFields.rows[0]?.active !== 10) throw new Error("Family/lead rotation left encrypted fields on a historical key.");
    const indexesAfter = await checkPool.query(`
      SELECT 'family' AS kind, id::text AS record_id, display_name_blind_index AS first_index, NULL::text AS second_index FROM families WHERE id=$1
      UNION ALL SELECT 'lead', lead_id::text, phone_blind_index, email_blind_index FROM lead_private_data WHERE lead_id=$2`, [familyId, leadId]);
    if (JSON.stringify(indexesBefore.rows) !== JSON.stringify(indexesAfter.rows)) throw new Error("Family/lead key rotation changed a blind index.");

    // Even with the rotation GUC, append-only history must reject changes to non-ciphertext fields.
    await checkPool.query("BEGIN");
    let appendOnlyGuarded = false;
    try {
      await checkPool.query("SELECT set_config('rudra.lead_sensitive_key_rotation','on',true)");
      await checkPool.query("UPDATE lead_activities SET activity_type='STATUS_CHANGE' WHERE id=$1", [leadActivityId]);
    } catch (error) { appendOnlyGuarded = error instanceof Error && /append-only/.test(error.message); }
    await checkPool.query("ROLLBACK");
    if (!appendOnlyGuarded) throw new Error("Lead history guard allowed a non-ciphertext update during key rotation.");
  } finally {
    if (familyLeadKeyRing === undefined) delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; else process.env.RUDRA_FIELD_ENCRYPTION_KEYS = familyLeadKeyRing;
    if (familyLeadKeyId === undefined) delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; else process.env.RUDRA_FIELD_ACTIVE_KEY_ID = familyLeadKeyId;
  }
  // Migration replay reruns the lead backfill verifier, so retain the disposable
  // replacement key only for this isolated schema's final replay checks.
  const replayKeyRingBefore = process.env.RUDRA_FIELD_ENCRYPTION_KEYS;
  const replayKeyIdBefore = process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
  let migrations;
  let migrationReplay;
  try {
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = familyLeadReplayKeyRing;
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = familyLeadReplayKeyId;
    migrations = await runMigrations(databaseUrl, null, schema);
    const expectedMigrationCount = (await getMigrationFiles()).length;
    migrationReplay = await runMigrations(databaseUrl, null, schema);
    if (migrations.total !== expectedMigrationCount || migrationReplay.total !== expectedMigrationCount || migrationReplay.applied !== 0) throw new Error(`Disposable schema migration replay was not stable (${migrations.applied} applied, ${migrationReplay.applied} on replay, ${migrationReplay.total} present, ${expectedMigrationCount} expected).`);
    console.log(`Populated synthetic patient/family/lead encryption qualification passed: patient/family/lead backfills replayed, patient and family/lead data-key rotations interrupted/resumed and replayed, append-only history guards verified, plaintext cutovers verified, post-cutover decrypt/index checks passed, and ${expectedMigrationCount} migrations replayed twice in an isolated test schema.`);
  } finally {
    if (replayKeyRingBefore === undefined) delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; else process.env.RUDRA_FIELD_ENCRYPTION_KEYS = replayKeyRingBefore;
    if (replayKeyIdBefore === undefined) delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; else process.env.RUDRA_FIELD_ACTIVE_KEY_ID = replayKeyIdBefore;
  }
} finally {
  await checkPool.end();
  if (schemaCreated) await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
}
