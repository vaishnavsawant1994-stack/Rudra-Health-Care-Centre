import { randomUUID } from "node:crypto";
import { createCipheriv, createHmac, randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hashPassword, verifyPassword } from "better-auth/crypto";
import { runMigrations } from "./migrate.mjs";
import { loadProjectEnvironment } from "./load-project-env.mjs";
import { computeAuditEventHash, GENESIS_AUDIT_HASH, verifyAuditChain } from "../src/server/audit-format.mjs";

loadProjectEnvironment();
const { Pool } = pg;

function fieldKey() {
  let keys; try { keys = JSON.parse(process.env.RUDRA_FIELD_ENCRYPTION_KEYS ?? "{}"); } catch { throw new Error("Field encryption keys are required for database integration checks."); }
  const keyId = process.env.RUDRA_FIELD_ACTIVE_KEY_ID; const key = Buffer.from(keys?.[keyId] ?? "", "base64");
  if (!keyId || key.length !== 32) throw new Error("Field encryption key is unavailable for database integration checks.");
  return { keyId, key };
}
function encryptLeadField(field, value, { organizationId, centreId, recordId }) {
  const { keyId, key } = fieldKey(); const nonce = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`rudra:lead-data:v1:${organizationId}:${centreId}:${recordId}:${field}:${keyId}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1.${keyId}.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}
function encryptOperationalValue(type, value, { organizationId, centreId, recordId }) {
  const { keyId, key } = fieldKey(); const nonce = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(Buffer.from(`rudra:operational-data:v1:${organizationId}:${centreId}:${type}:${recordId}:${keyId}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1.${keyId}.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}
function leadIndex(field, value) {
  const key = Buffer.from(process.env.RUDRA_BLIND_INDEX_KEY ?? "", "base64"); if (key.length !== 32) throw new Error("Blind-index key is unavailable for database integration checks.");
  const normalized = field === "phone" ? value.trim().replace(/[ ()-]/g, "") : value.trim().toLocaleLowerCase("en-US");
  return createHmac("sha256", key).update(`rudra:lead-contact-index:v1:${field}:`).update(normalized).digest("hex");
}

const databaseUrl = process.env.DATABASE_TEST_URL;
if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  console.error("DATABASE_TEST_URL is required. Create a dedicated empty database whose name contains 'test'; no database changes were made.");
  process.exit(1);
}
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.replace(/^\//, ""));
if (!/test/i.test(databaseName)) {
  console.error("Refusing to use DATABASE_TEST_URL because its database name does not contain 'test'.");
  process.exit(1);
}

const first = await runMigrations(databaseUrl);
const replay = await runMigrations(databaseUrl);
if (replay.applied !== 0 || first.total !== replay.total) throw new Error("Migration replay did not remain stable.");

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-health-os-db-test" });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const orgId = randomUUID();
  const centreId = randomUUID();
  const staffId = randomUUID();
  const authUserId = randomUUID();
  const sessionId = randomUUID();
  const roleId = randomUUID();
  const permissionId = randomUUID();
  const assignmentId = randomUUID();
  const patientId = randomUUID();
  const secondPatientId = randomUUID();
  const leadId = randomUUID();
  const leadFollowupId = randomUUID();
  const leadConversionId = randomUUID();
  const communicationDraftId = randomUUID();
  const communicationDraftEventId = randomUUID();
  const communicationTemplateId = randomUUID();
  const communicationTemplateEventId = randomUUID();
  const auditId = randomUUID();
  const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
  const otherOrgId = randomUUID();
  await client.query("INSERT INTO organizations (id, code, name) VALUES ($1, $2, $3)", [orgId, `TEST-${seed}`, "Synthetic migration check"]);
  await client.query("INSERT INTO organizations (id, code, name) VALUES ($1, $2, $3)", [otherOrgId, `TEST2-${seed}`, "Synthetic isolation check"]);
  await client.query("INSERT INTO centres (id, organization_id, code, name) VALUES ($1, $2, $3, $4)", [centreId, orgId, `C-${seed}`, "Synthetic centre"]);
  const syntheticPassword = `Synthetic-Only-${randomUUID()}!`;
  const passwordHash = await hashPassword(syntheticPassword);
  await client.query('INSERT INTO "user" (id, name, email, "emailVerified") VALUES ($1, $2, $3, true)', [authUserId, "Synthetic staff", `${seed.toLowerCase()}@invalid.test`]);
  await client.query('INSERT INTO "account" (id, "accountId", "providerId", "userId", password) VALUES ($1, $2, \'credential\', $3, $4)', [randomUUID(), authUserId, authUserId, passwordHash]);
  const persistedAccount = await client.query('SELECT password FROM "account" WHERE "userId" = $1 AND "providerId" = \'credential\'', [authUserId]);
  if (persistedAccount.rowCount !== 1 || !(await verifyPassword({ hash: persistedAccount.rows[0].password, password: syntheticPassword })) || await verifyPassword({ hash: persistedAccount.rows[0].password, password: `${syntheticPassword}wrong` })) throw new Error("Synthetic credential persistence or password verification failed.");
  const twoFactorState = await client.query('SELECT "twoFactorEnabled" FROM "user" WHERE id = $1', [authUserId]);
  if (twoFactorState.rows[0]?.twoFactorEnabled !== false) throw new Error("New synthetic account should remain unprivileged until TOTP enrollment.");
  const sessionToken = randomUUID();
  await client.query('INSERT INTO "session" (id, token, "userId", "expiresAt") VALUES ($1, $2, $3, now() + interval \'1 hour\')', [sessionId, sessionToken, authUserId]);
  const persistedSession = await client.query('SELECT id, "mfaVerifiedAt" FROM "session" WHERE token = $1 AND "userId" = $2 AND "expiresAt" > now()', [sessionToken, authUserId]);
  if (persistedSession.rowCount !== 1 || persistedSession.rows[0].mfaVerifiedAt !== null) throw new Error("Synthetic session did not persist with an initially unverified MFA state.");
  const mfaVerifiedAt = new Date();
  await client.query('UPDATE "session" SET "mfaVerifiedAt" = $2 WHERE id = $1', [sessionId, mfaVerifiedAt]);
  const verifiedSession = await client.query('SELECT "mfaVerifiedAt" FROM "session" WHERE id = $1', [sessionId]);
  if (!verifiedSession.rows[0]?.mfaVerifiedAt) throw new Error("Synthetic per-session MFA proof did not persist.");
  await client.query('DELETE FROM "session" WHERE id = $1 AND "userId" = $2', [sessionId, authUserId]);
  const revokedSession = await client.query('SELECT id FROM "session" WHERE id = $1 AND "userId" = $2', [sessionId, authUserId]);
  if (revokedSession.rowCount !== 0) throw new Error("Synthetic session revocation did not invalidate the session.");
  await client.query("INSERT INTO staff_users (id, auth_user_id, organization_id, staff_code, display_name, status) VALUES ($1, $2, $3, $4, $5, 'ACTIVE')", [staffId, authUserId, orgId, `RHC-STF-${seed}`, "Synthetic staff"]);
  const doctorId=randomUUID(),doctorEventId=randomUUID(),doctorNumber=`RHC-D-${seed}`;
  await client.query("INSERT INTO doctor_profiles(id,organization_id,centre_id,doctor_number,specialty,private_data_ciphertext,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,$3,$4,'Synthetic specialty',$5,$6,$6)",[doctorId,orgId,centreId,doctorNumber,encryptOperationalValue("doctor-profile",{name:"Synthetic doctor",phone:null,email:null,registrationReference:"SYNTH-REG",affiliation:null,notes:null},{organizationId:orgId,centreId,recordId:doctorId}),staffId]);
  await client.query("INSERT INTO doctor_relationship_events(id,organization_id,centre_id,doctor_id,event_type,private_data_ciphertext,actor_staff_id) VALUES($1,$2,$3,$4,'CREATED',$5,$6)",[doctorEventId,orgId,centreId,doctorId,encryptOperationalValue("doctor-relationship-event",{version:1},{organizationId:orgId,centreId,recordId:doctorEventId}),staffId]);
  const doctorStored=await client.query("SELECT doctor_number,private_data_ciphertext FROM doctor_profiles WHERE id=$1 AND organization_id=$2 AND centre_id=$3",[doctorId,orgId,centreId]);
  if(doctorStored.rowCount!==1||doctorStored.rows[0].doctor_number!==doctorNumber||doctorStored.rows[0].private_data_ciphertext.includes("Synthetic doctor"))throw new Error("Synthetic encrypted doctor profile did not persist correctly.");
  await client.query("SAVEPOINT doctor_event_immutable");let doctorEventMutationDenied=false;try{await client.query("UPDATE doctor_relationship_events SET event_type='UPDATED' WHERE id=$1",[doctorEventId]);}catch{doctorEventMutationDenied=true;await client.query("ROLLBACK TO SAVEPOINT doctor_event_immutable");}if(!doctorEventMutationDenied)throw new Error("Doctor relationship history accepted mutation.");
  const relationshipId=randomUUID(),relationshipEventId=randomUUID(),relationshipNumber=`RHC-C-${seed}`;
  const corpPrivate={name:"Synthetic corporate client",legalName:"Synthetic corporate legal name",primaryContactName:"Synthetic contact",primaryContactRole:"HR",phone:"+910000000001",email:"synthetic-corp@invalid.test",address:"Synthetic business address",agreementReference:"SYNTH-AGREEMENT",agreementStatus:"PENDING_REVIEW",notes:"Synthetic private relationship note"};
  await client.query("INSERT INTO business_relationships(id,organization_id,centre_id,relationship_type,relationship_number,category,private_data_ciphertext,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,$3,'CORPORATE',$4,'EMPLOYER',$5,$6,$6)",[relationshipId,orgId,centreId,relationshipNumber,encryptOperationalValue("business-relationship-corporate",corpPrivate,{organizationId:orgId,centreId,recordId:relationshipId}),staffId]);
  await client.query("INSERT INTO business_relationship_events(id,organization_id,centre_id,relationship_id,relationship_type,event_type,private_data_ciphertext,actor_staff_id) VALUES($1,$2,$3,$4,'CORPORATE','CREATED',$5,$6)",[relationshipEventId,orgId,centreId,relationshipId,encryptOperationalValue("business-relationship-corporate-event",{version:1},{organizationId:orgId,centreId,recordId:relationshipEventId}),staffId]);
  const relationshipStored=await client.query("SELECT relationship_number,private_data_ciphertext FROM business_relationships WHERE id=$1 AND organization_id=$2 AND centre_id=$3",[relationshipId,orgId,centreId]);
  if(relationshipStored.rowCount!==1||relationshipStored.rows[0].relationship_number!==relationshipNumber||relationshipStored.rows[0].private_data_ciphertext.includes("Synthetic corporate client")||relationshipStored.rows[0].private_data_ciphertext.includes("synthetic-corp@invalid.test"))throw new Error("Synthetic encrypted business relationship did not persist correctly.");
  const attributedLeadId=randomUUID(),attributedLeadNumber=`RHC-L-ATTR-${seed}`;
  await client.query("INSERT INTO leads(id,organization_id,centre_id,lead_number,enquiry_category,source,source_relationship_id,source_relationship_type,assigned_staff_id,created_by_staff_id) VALUES($1,$2,$3,$4,'GENERAL','CORPORATE',$5,'CORPORATE',$6,$6)",[attributedLeadId,orgId,centreId,attributedLeadNumber,relationshipId,staffId]);
  const attributedLead=await client.query("SELECT lead_number,source,source_relationship_id,source_relationship_type FROM leads WHERE id=$1 AND organization_id=$2 AND centre_id=$3",[attributedLeadId,orgId,centreId]);
  if(attributedLead.rowCount!==1||attributedLead.rows[0].lead_number!==attributedLeadNumber||attributedLead.rows[0].source_relationship_id!==relationshipId||attributedLead.rows[0].source_relationship_type!=="CORPORATE")throw new Error("Corporate CRM source attribution did not persist.");
  await client.query("SAVEPOINT relationship_attribution_type_guard");let wrongAttributionTypeDenied=false;try{await client.query("INSERT INTO leads(id,organization_id,centre_id,lead_number,enquiry_category,source,source_relationship_id,source_relationship_type,assigned_staff_id,created_by_staff_id) VALUES($1,$2,$3,$4,'GENERAL','CORPORATE',$5,'PARTNER',$6,$6)",[randomUUID(),orgId,centreId,`RHC-L-X-${seed}`,relationshipId,staffId]);}catch{wrongAttributionTypeDenied=true;await client.query("ROLLBACK TO SAVEPOINT relationship_attribution_type_guard");}if(!wrongAttributionTypeDenied)throw new Error("Lead source relationship type mismatch was accepted.");
  await client.query("SAVEPOINT relationship_event_immutable");let relationshipEventMutationDenied=false;try{await client.query("UPDATE business_relationship_events SET event_type='UPDATED' WHERE id=$1",[relationshipEventId]);}catch{relationshipEventMutationDenied=true;await client.query("ROLLBACK TO SAVEPOINT relationship_event_immutable");}if(!relationshipEventMutationDenied)throw new Error("Business relationship history accepted mutation.");
  const websitePageId = randomUUID(); const websiteVersionId = randomUUID(); const websiteEventId = randomUUID();
  await client.query("INSERT INTO website_content_pages (id, organization_id, slug, draft_ciphertext, draft_version, created_by_staff_id, updated_by_staff_id) VALUES ($1,$2,'about','synthetic-encrypted-envelope',1,$3,$3)", [websitePageId, orgId, staffId]);
  const supportedWebsiteSlugs = ["home", "home-collection", "faq", "corporate", "doctors", "partners", "centres", "service-areas", "tests", "packages", "booking", "contact"];
  for (const slug of supportedWebsiteSlugs) {
    await client.query("INSERT INTO website_content_pages (id, organization_id, slug, draft_ciphertext, draft_version, created_by_staff_id, updated_by_staff_id) VALUES ($1,$2,$3,'synthetic-encrypted-envelope',1,$4,$4)", [randomUUID(), orgId, slug, staffId]);
  }
  const websiteSlugConstraint = await client.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'website_content_pages'::regclass AND conname = 'website_content_slug_allowed'");
  if (websiteSlugConstraint.rowCount !== 1 || supportedWebsiteSlugs.some((slug) => !websiteSlugConstraint.rows[0].definition.includes(`'${slug}'`))) throw new Error("Website content database slug allowlist does not include every supported editor page.");
  await client.query("INSERT INTO website_content_versions (id, organization_id, page_id, version_number, content_ciphertext, actor_staff_id) VALUES ($1,$2,$3,1,'synthetic-encrypted-envelope',$4)", [websiteVersionId, orgId, websitePageId, staffId]);
  await client.query("INSERT INTO website_content_events (id, organization_id, page_id, event_type, event_ciphertext, actor_staff_id) VALUES ($1,$2,$3,'DRAFT_SAVED','synthetic-encrypted-event',$4)", [websiteEventId, orgId, websitePageId, staffId]);
  await client.query("SAVEPOINT immutable_website_version");
  let websiteVersionMutationDenied = false;
  try { await client.query("UPDATE website_content_versions SET content_ciphertext = 'changed' WHERE id = $1", [websiteVersionId]); }
  catch { websiteVersionMutationDenied = true; await client.query("ROLLBACK TO SAVEPOINT immutable_website_version"); }
  if (!websiteVersionMutationDenied) throw new Error("Website content version mutation was accepted.");
  await client.query("SAVEPOINT immutable_website_event");
  let websiteEventMutationDenied = false;
  try { await client.query("DELETE FROM website_content_events WHERE id = $1", [websiteEventId]); }
  catch { websiteEventMutationDenied = true; await client.query("ROLLBACK TO SAVEPOINT immutable_website_event"); }
  if (!websiteEventMutationDenied) throw new Error("Website content event deletion was accepted.");
  const patientNumber = `RHC-2099-${seed}`;
  await client.query("INSERT INTO patients (id, organization_id, centre_id, patient_number, consent_status, consent_recorded_at, consent_method, created_by_staff_id) VALUES ($1, $2, $3, $4, 'GRANTED', now(), 'IN_PERSON', $5)", [patientId, orgId, centreId, patientNumber, staffId]);
  await client.query("INSERT INTO patients (id, organization_id, centre_id, patient_number, consent_status, consent_recorded_at, consent_method, created_by_staff_id) VALUES ($1, $2, $3, $4, 'GRANTED', now(), 'IN_PERSON', $5)", [secondPatientId, orgId, centreId, `RHC-2099-R-${seed}`, staffId]);
  await client.query("INSERT INTO patient_contact_secrets(patient_id,organization_id,centre_id,encryption_key_id,phone_ciphertext,email_ciphertext,profile_ciphertext,name_ciphertext,phone_blind_index,email_blind_index,first_name_blind_index,last_name_blind_index,full_name_blind_index) VALUES($1,$2,$3,'test-v1','test-ciphertext',NULL,'test-profile','test-name',$4,NULL,$7,$8,$9),($5,$2,$3,'test-v1','test-ciphertext',NULL,'test-profile','test-name',$6,NULL,$10,$11,$12)",[patientId,orgId,centreId,"a".repeat(64),secondPatientId,"b".repeat(64),"c".repeat(64),"d".repeat(64),"e".repeat(64),"f".repeat(64),"0".repeat(64),"1".repeat(64)]);
  await client.query("SAVEPOINT duplicate_patient_blind_index");let duplicatePatientContactIndexDenied=false;try{await client.query("UPDATE patient_contact_secrets SET phone_blind_index=$1 WHERE patient_id=$2",["a".repeat(64),secondPatientId]);}catch{duplicatePatientContactIndexDenied=true;await client.query("ROLLBACK TO SAVEPOINT duplicate_patient_blind_index");}if(!duplicatePatientContactIndexDenied)throw new Error("Duplicate patient contact blind index was accepted.");
  const patientRows = await client.query("SELECT patient_number FROM patients WHERE id = $1 AND organization_id = $2 AND centre_id = $3", [patientId, orgId, centreId]);
  if (patientRows.rowCount !== 1 || patientRows.rows[0].patient_number !== patientNumber) throw new Error("Synthetic patient persistence or centre scoping failed.");

  const leadNumber = `RHC-L-${seed}`;
  const leadPhone="+910000000001",leadEmail=`lead-${seed.toLowerCase()}@synthetic.invalid`,leadContext={organizationId:orgId,centreId,recordId:leadId};
  await client.query("INSERT INTO leads (id, organization_id, centre_id, lead_number, enquiry_category, source, status, assigned_staff_id, created_by_staff_id) VALUES ($1, $2, $3, $4, 'GENERAL', 'WALK_IN', 'QUALIFIED', $5, $5)", [leadId, orgId, centreId, leadNumber, staffId]);
  await client.query("INSERT INTO lead_private_data(lead_id,organization_id,centre_id,payload_ciphertext,phone_blind_index,email_blind_index) VALUES($1,$2,$3,$4,$5,$6)",[leadId,orgId,centreId,encryptLeadField("private-data",{firstName:"Synthetic",lastName:"Enquirer",phone:leadPhone,email:leadEmail,interestedService:null,campaign:null,contactEvidenceReference:null,marketingEvidenceReference:null,lostReason:null},leadContext),leadIndex("phone",leadPhone),leadIndex("email",leadEmail)]);
  const activityId=randomUUID();
  await client.query("INSERT INTO lead_activities(id, organization_id, centre_id, lead_id, actor_staff_id, activity_type, private_payload_ciphertext) VALUES ($1,$2,$3,$4,$5,'CREATED',$6)", [activityId,orgId,centreId,leadId,staffId,encryptLeadField("activity",{body:null,metadata:{source:"WALK_IN"}},{organizationId:orgId,centreId,recordId:activityId})]);
  const persistedLead = await client.query("SELECT lead_number, status, contact_permission, marketing_consent FROM leads WHERE id = $1 AND organization_id = $2 AND centre_id = $3", [leadId, orgId, centreId]);
  if (persistedLead.rowCount !== 1 || persistedLead.rows[0].lead_number !== leadNumber || persistedLead.rows[0].status !== "QUALIFIED" || persistedLead.rows[0].contact_permission !== "PENDING" || persistedLead.rows[0].marketing_consent !== "NOT_REQUESTED") throw new Error("Synthetic lead did not persist with separate pending contact and marketing consent states.");
  await client.query("UPDATE leads SET contact_permission = 'AUTHORIZED', contact_permission_recorded_by = $2, contact_permission_recorded_at = now() WHERE id = $1", [leadId, staffId]);
  await client.query("UPDATE leads SET marketing_consent = 'GRANTED', marketing_consent_recorded_by = $2, marketing_consent_recorded_at = now() WHERE id = $1", [leadId, staffId]);
  const consentStates = await client.query("SELECT contact_permission, marketing_consent FROM leads WHERE id = $1", [leadId]);
  if (consentStates.rows[0]?.contact_permission !== "AUTHORIZED" || consentStates.rows[0]?.marketing_consent !== "GRANTED") throw new Error("Operational contact permission and marketing consent did not persist independently.");
  const draftBody = "Synthetic operational reminder; no health details.";
  const draftCiphertext = encryptLeadField("communication-draft", draftBody, { organizationId: orgId, centreId, recordId: communicationDraftId });
  await client.query("INSERT INTO lead_communication_drafts(id,organization_id,centre_id,lead_id,created_by_staff_id,purpose,channel,body_ciphertext,idempotency_key) VALUES($1,$2,$3,$4,$5,'OPERATIONAL','PHONE',$6,$7)", [communicationDraftId,orgId,centreId,leadId,staffId,draftCiphertext,randomUUID()]);
  await client.query("INSERT INTO lead_communication_draft_events(id,organization_id,centre_id,draft_id,actor_staff_id,event_type) VALUES($1,$2,$3,$4,$5,'CREATED')", [communicationDraftEventId,orgId,centreId,communicationDraftId,staffId]);
  const persistedDraft = await client.query("SELECT body_ciphertext FROM lead_communication_drafts WHERE id=$1 AND organization_id=$2 AND centre_id=$3", [communicationDraftId,orgId,centreId]);
  if (persistedDraft.rowCount !== 1 || persistedDraft.rows[0].body_ciphertext.includes(draftBody)) throw new Error("Synthetic communication draft did not persist only as ciphertext.");
  await client.query("SAVEPOINT immutable_communication_draft_event"); let draftEventMutationDenied = false;
  try { await client.query("UPDATE lead_communication_draft_events SET event_type='CANCELLED' WHERE id=$1", [communicationDraftEventId]); } catch { draftEventMutationDenied = true; await client.query("ROLLBACK TO SAVEPOINT immutable_communication_draft_event"); }
  if (!draftEventMutationDenied) throw new Error("Communication draft event history was mutable.");
  const templatePrivate = { name: "Synthetic appointment reminder", body: "Hello {{firstName}}, your synthetic appointment is {{appointmentDate}}." };
  const templateCiphertext = encryptOperationalValue("communication-template", templatePrivate, { organizationId: orgId, centreId, recordId: communicationTemplateId });
  await client.query("INSERT INTO communication_templates(id,organization_id,centre_id,created_by_staff_id,updated_by_staff_id,purpose,channel,status,version_number,private_data_ciphertext,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$4,'OPERATIONAL','EMAIL','DRAFT',1,$5,$6,$7)", [communicationTemplateId,orgId,centreId,staffId,templateCiphertext,randomUUID(),"a".repeat(64)]);
  const templateStored = await client.query("SELECT private_data_ciphertext FROM communication_templates WHERE id=$1 AND organization_id=$2 AND centre_id=$3", [communicationTemplateId,orgId,centreId]);
  if (templateStored.rowCount !== 1 || templateStored.rows[0].private_data_ciphertext.includes(templatePrivate.name) || templateStored.rows[0].private_data_ciphertext.includes(templatePrivate.body)) throw new Error("Synthetic communication template did not persist only as ciphertext.");
  await client.query("INSERT INTO communication_template_events(id,organization_id,centre_id,template_id,actor_staff_id,event_type,private_data_ciphertext,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'CREATED',$6,$7,$8)", [communicationTemplateEventId,orgId,centreId,communicationTemplateId,staffId,encryptOperationalValue("communication-template-event",{...templatePrivate,status:"DRAFT",versionNumber:1},{organizationId:orgId,centreId,recordId:communicationTemplateEventId}),randomUUID(),"b".repeat(64)]);
  await client.query("SAVEPOINT immutable_communication_template_event"); let templateEventMutationDenied = false;
  try { await client.query("UPDATE communication_template_events SET event_type='UPDATED' WHERE id=$1", [communicationTemplateEventId]); } catch { templateEventMutationDenied = true; await client.query("ROLLBACK TO SAVEPOINT immutable_communication_template_event"); }
  if (!templateEventMutationDenied) throw new Error("Communication template history accepted mutation.");
  await client.query("INSERT INTO lead_followups (id, organization_id, centre_id, lead_id, assigned_staff_id, due_at, task_type, created_by_staff_id) VALUES ($1, $2, $3, $4, $5, now() + interval '1 hour', 'CONTACT', $5)", [leadFollowupId, orgId, centreId, leadId, staffId]);
  await client.query("UPDATE lead_followups SET status = 'COMPLETED', outcome = 'CONTACTED', completed_by_staff_id = $2, completed_at = now(), updated_at = now() WHERE id = $1", [leadFollowupId, staffId]);
  const completedFollowup = await client.query("SELECT status, outcome, completed_at FROM lead_followups WHERE id = $1", [leadFollowupId]);
  if (completedFollowup.rows[0]?.status !== "COMPLETED" || completedFollowup.rows[0]?.outcome !== "CONTACTED" || !completedFollowup.rows[0]?.completed_at) throw new Error("Synthetic lead follow-up lifecycle did not complete.");
  await client.query("INSERT INTO lead_conversions (id, organization_id, centre_id, lead_id, patient_id, conversion_mode, converted_by_staff_id) VALUES ($1, $2, $3, $4, $5, 'NEW', $6)", [leadConversionId, orgId, centreId, leadId, patientId, staffId]);
  await client.query("UPDATE leads SET status = 'CONVERTED', converted_at = now(), updated_at = now() WHERE id = $1", [leadId]);
  const convertedLead = await client.query("SELECT l.status, c.patient_id FROM leads l JOIN lead_conversions c ON c.lead_id = l.id AND c.organization_id = l.organization_id WHERE l.id = $1", [leadId]);
  if (convertedLead.rows[0]?.status !== "CONVERTED" || convertedLead.rows[0]?.patient_id !== patientId) throw new Error("Synthetic lead-to-patient conversion did not persist transactionally.");
  const appointmentId = randomUUID();
  const appointmentKey = randomUUID();
  const appointmentAt = new Date(Date.now() + 48 * 60 * 60_000);
  const appointmentPrivate = encryptOperationalValue("appointment", { homeCollectionAddress: { line1: "12 Synthetic Road", city: "Test City", state: "Test State", postalCode: "123456" }, collectionInstructions: null, communicationEvidenceReference: null, homeChargeReason: null }, { organizationId: orgId, centreId, recordId: appointmentId });
  await client.query("INSERT INTO appointments (id, organization_id, centre_id, appointment_number, patient_id, lead_id, booking_source, visit_type, scheduled_at, duration_minutes, time_zone, status, assigned_staff_id, home_collection_window, home_charge_choice, home_charge_rupees, private_data_ciphertext, created_by_staff_id, idempotency_key, request_hash) VALUES ($1,$2,$3,$4,$5,$6,'CRM_LEAD','HOME_COLLECTION',$7,30,'Asia/Kolkata','ASSIGNED',$8,'9-11 AM','75',75,$9,$8,$10,$11)", [appointmentId, orgId, centreId, `RHC-A-2099-${seed}`, patientId, leadId, appointmentAt, staffId, appointmentPrivate, appointmentKey, "a".repeat(64)]);
  const appointmentServiceId = randomUUID();
  await client.query("INSERT INTO appointment_services (id,organization_id,centre_id,appointment_id,service_type,private_data_ciphertext) VALUES ($1,$2,$3,$4,'OTHER',$5)", [appointmentServiceId, orgId, centreId, appointmentId, encryptOperationalValue("appointment-service", { serviceName: "Synthetic requested service", serviceReference: null }, { organizationId: orgId, centreId, recordId: appointmentServiceId })]);
  const appointmentHistoryId = randomUUID();
  await client.query("INSERT INTO appointment_status_history (id,organization_id,centre_id,appointment_id,to_status,private_data_ciphertext,new_scheduled_at,actor_staff_id) VALUES ($1,$2,$3,$4,'ASSIGNED',$5,$6,$7)", [appointmentHistoryId, orgId, centreId, appointmentId, encryptOperationalValue("appointment-status-history", { reason: "Synthetic booking created" }, { organizationId: orgId, centreId, recordId: appointmentHistoryId }), appointmentAt, staffId]);
  const appointmentAssignmentId = randomUUID();
  await client.query("INSERT INTO appointment_assignment_history (id,organization_id,centre_id,appointment_id,action,staff_id,work_start,work_end,private_data_ciphertext,actor_staff_id) VALUES ($1,$2,$3,$4,'ASSIGNED',$5,$6::timestamptz,$6::timestamptz+interval '30 minutes',$7,$5)", [appointmentAssignmentId, orgId, centreId, appointmentId, staffId, appointmentAt, encryptOperationalValue("appointment-assignment-history", { reason: "Synthetic assignment" }, { organizationId: orgId, centreId, recordId: appointmentAssignmentId })]);
  const persistedAppointment = await client.query("SELECT status, visit_type, home_charge_choice, home_charge_rupees FROM appointments WHERE id = $1 AND organization_id = $2 AND centre_id = $3 AND patient_id = $4", [appointmentId, orgId, centreId, patientId]);
  if (persistedAppointment.rowCount !== 1 || persistedAppointment.rows[0].status !== "ASSIGNED" || persistedAppointment.rows[0].visit_type !== "HOME_COLLECTION" || persistedAppointment.rows[0].home_charge_choice !== "75" || persistedAppointment.rows[0].home_charge_rupees !== 75) throw new Error("Synthetic appointment did not persist with scoped patient, assignment, and separate home charge.");
  const arrivalAppointmentId = randomUUID(); const arrivalKey = randomUUID();
  await client.query("INSERT INTO appointments (id, organization_id, centre_id, appointment_number, patient_id, booking_source, visit_type, scheduled_at, time_zone, status, private_data_ciphertext, created_by_staff_id, idempotency_key, request_hash) VALUES ($1,$2,$3,$4,$5,'WALK_IN','CENTRE',$6,'Asia/Kolkata','CONFIRMED',$7,$8,$9,$10)", [arrivalAppointmentId, orgId, centreId, `RHC-ARR-${seed}`, patientId, new Date(), encryptOperationalValue("appointment", { homeCollectionAddress: null, collectionInstructions: null, communicationEvidenceReference: null, homeChargeReason: null }, { organizationId: orgId, centreId, recordId: arrivalAppointmentId }), staffId, randomUUID(), "d".repeat(64)]);
  const arrivalEventId = randomUUID();
  await client.query("INSERT INTO appointment_arrival_events (id,organization_id,centre_id,appointment_id,actor_staff_id,idempotency_key,request_hash) VALUES ($1,$2,$3,$4,$5,$6,$7)", [arrivalEventId, orgId, centreId, arrivalAppointmentId, staffId, arrivalKey, "e".repeat(64)]);
  const savedArrival = await client.query("SELECT arrival_source,actor_staff_id,appointment_id FROM appointment_arrival_events WHERE id=$1 AND organization_id=$2 AND centre_id=$3", [arrivalEventId, orgId, centreId]);
  if (savedArrival.rowCount !== 1 || savedArrival.rows[0].arrival_source !== "FRONT_DESK" || savedArrival.rows[0].actor_staff_id !== staffId || savedArrival.rows[0].appointment_id !== arrivalAppointmentId) throw new Error("Synthetic reception arrival was not persisted with its authorized appointment scope and actor.");
  await client.query("SAVEPOINT duplicate_appointment_arrival"); let duplicateArrivalDenied = false;
  try { await client.query("INSERT INTO appointment_arrival_events (organization_id,centre_id,appointment_id,actor_staff_id,idempotency_key,request_hash) VALUES ($1,$2,$3,$4,$5,$6)", [orgId, centreId, arrivalAppointmentId, staffId, randomUUID(), "f".repeat(64)]); } catch { duplicateArrivalDenied = true; await client.query("ROLLBACK TO SAVEPOINT duplicate_appointment_arrival"); }
  if (!duplicateArrivalDenied) throw new Error("A second front-desk arrival event for one appointment was accepted.");
  await client.query("SAVEPOINT immutable_appointment_arrival"); let arrivalMutationDenied = false;
  try { await client.query("UPDATE appointment_arrival_events SET request_hash=$2 WHERE id=$1", [arrivalEventId, "c".repeat(64)]); } catch { arrivalMutationDenied = true; await client.query("ROLLBACK TO SAVEPOINT immutable_appointment_arrival"); }
  if (!arrivalMutationDenied) throw new Error("Front-desk arrival history was mutable.");
  const scheduledShiftId = randomUUID();
  await client.query("INSERT INTO staff_shifts (id,organization_id,centre_id,staff_id,shift_type,starts_at,ends_at,time_zone,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES ($1,$2,$3,$4,'SCHEDULED',$5,$5::timestamptz + interval '30 minutes','Asia/Kolkata',$6,$4,$7,$8)", [scheduledShiftId,orgId,centreId,staffId,appointmentAt,encryptOperationalValue("staff-shift",{note:"Synthetic shift coverage"},{organizationId:orgId,centreId,recordId:scheduledShiftId}),randomUUID(),"f".repeat(64)]);
  const unavailableShiftId = randomUUID(); const collectionAt = new Date(appointmentAt.getTime() + 60 * 60_000);
  await client.query("INSERT INTO staff_shifts (id,organization_id,centre_id,staff_id,shift_type,starts_at,ends_at,time_zone,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES ($1,$2,$3,$4,'UNAVAILABLE',$5,$5::timestamptz + interval '30 minutes','Asia/Kolkata',$6,$4,$7,$8)", [unavailableShiftId,orgId,centreId,staffId,collectionAt,encryptOperationalValue("staff-shift",{note:"Synthetic unavailability"},{organizationId:orgId,centreId,recordId:unavailableShiftId}),randomUUID(),"1".repeat(64)]);
  const shiftEvents = [[scheduledShiftId,"SCHEDULED",appointmentAt,randomUUID()],[unavailableShiftId,"UNAVAILABLE",collectionAt,randomUUID()]];
  for (const [shiftId,shiftType,at,eventId] of shiftEvents) await client.query("INSERT INTO staff_shift_events (id,organization_id,centre_id,shift_id,event_type,private_data_ciphertext,actor_staff_id) VALUES ($1,$2,$3,$4,'CREATED',$5,$6)",[eventId,orgId,centreId,shiftId,encryptOperationalValue("staff-shift-event",{shiftType,startsAt:at.toISOString()},{organizationId:orgId,centreId,recordId:eventId}),staffId]);
  const appointmentCoverage = await client.query("SELECT count(*)::int AS outside FROM appointments a WHERE a.id=$1 AND NOT EXISTS (SELECT 1 FROM staff_shifts s WHERE s.organization_id=a.organization_id AND s.centre_id=a.centre_id AND s.staff_id=a.assigned_staff_id AND s.status='ACTIVE' AND s.shift_type='SCHEDULED' AND s.starts_at<=a.scheduled_at AND s.ends_at>=a.scheduled_at+(a.duration_minutes*INTERVAL '1 minute'))",[appointmentId]);
  if (appointmentCoverage.rows[0]?.outside !== 0) throw new Error("Roster coverage diagnostic incorrectly flags an appointment covered by a scheduled shift.");
  await client.query("SAVEPOINT appointment_duplicate_idempotency");
  let duplicateAppointmentKeyDenied = false;
  try {
    await client.query("INSERT INTO appointments (organization_id, centre_id, appointment_number, patient_id, booking_source, visit_type, scheduled_at, time_zone, created_by_staff_id, idempotency_key, request_hash) VALUES ($1,$2,$3,$4,'STAFF','CENTRE',$5,'Asia/Kolkata',$6,$7,$8)", [orgId, centreId, `RHC-A-DUP-${seed}`, patientId, appointmentAt, staffId, appointmentKey, "c".repeat(64)]);
  } catch { duplicateAppointmentKeyDenied = true; await client.query("ROLLBACK TO SAVEPOINT appointment_duplicate_idempotency"); }
  if (!duplicateAppointmentKeyDenied) throw new Error("Duplicate appointment idempotency key was accepted.");
  const serviceState = await client.query("SELECT verification_status FROM appointment_services WHERE appointment_id = $1", [appointmentId]);
  if (serviceState.rows[0]?.verification_status !== "PENDING") throw new Error("Appointment service reference must remain pending verification.");
  await client.query("SAVEPOINT appointment_cross_centre_patient");
  let crossCentreAppointmentDenied = false;
  try {
    const otherAppointmentCentre = await client.query("INSERT INTO centres (organization_id, code, name) VALUES ($1,$2,'Synthetic appointment isolation centre') RETURNING id", [orgId, `AC-${seed}`]);
    const otherAppointmentPatient = await client.query("INSERT INTO patients (organization_id, centre_id, patient_number, consent_status, consent_recorded_at, consent_method, created_by_staff_id) VALUES ($1,$2,$3,'GRANTED',now(),'IN_PERSON',$4) RETURNING id", [orgId, otherAppointmentCentre.rows[0].id, `RHC-AP-X-${seed}`, staffId]);
    await client.query("INSERT INTO appointments (organization_id, centre_id, appointment_number, patient_id, booking_source, visit_type, scheduled_at, time_zone, created_by_staff_id, idempotency_key, request_hash) VALUES ($1,$2,$3,$4,'STAFF','CENTRE',$5,'Asia/Kolkata',$6,$7,$8)", [orgId, centreId, `RHC-A-X-${seed}`, otherAppointmentPatient.rows[0].id, appointmentAt, staffId, randomUUID(), "b".repeat(64)]);
  } catch { crossCentreAppointmentDenied = true; await client.query("ROLLBACK TO SAVEPOINT appointment_cross_centre_patient"); }
  if (!crossCentreAppointmentDenied) throw new Error("Cross-centre patient appointment association was accepted.");
  await client.query("SAVEPOINT immutable_appointment_history");
  let appointmentHistoryUpdateDenied = false;
  try { await client.query("UPDATE appointment_status_history SET private_data_ciphertext = 'tampered' WHERE appointment_id = $1", [appointmentId]); }
  catch { appointmentHistoryUpdateDenied = true; await client.query("ROLLBACK TO SAVEPOINT immutable_appointment_history"); }
  if (!appointmentHistoryUpdateDenied) throw new Error("Appointment status history update was accepted.");
  const appointmentPermissions = await client.query("SELECT key FROM permissions WHERE key = ANY($1::text[])", [["appointments.read", "appointments.assigned.read", "appointments.create", "appointments.update", "appointments.assign", "appointments.cancel", "appointments.home_charge.manage"]]);
  if (appointmentPermissions.rowCount !== 7) throw new Error("Appointment permission migration did not register all expected permissions.");
  const catalogueItemId = randomUUID(); const catalogueVersionId = randomUUID(); const packageItemId = randomUUID(); const packageVersionId = randomUUID();
  await client.query("INSERT INTO diagnostic_catalogue_items (id, organization_id, centre_id, service_type, service_code, current_version, created_by_staff_id) VALUES ($1,$2,$3,'TEST',$4,1,$5)", [catalogueItemId, orgId, centreId, `T-${seed}`, staffId]);
  if ((await client.query("SELECT public_visible FROM diagnostic_catalogue_items WHERE id=$1", [catalogueItemId])).rows[0]?.public_visible !== false) throw new Error("New catalogue items must remain internal until explicitly published.");
  await client.query("INSERT INTO diagnostic_catalogue_versions (id, organization_id, centre_id, catalogue_item_id, version_number, display_name, verification_status, price_amount, effective_from, source_type, created_by_staff_id) VALUES ($1,$2,$3,$4,1,'Synthetic test', 'UNVERIFIED', 300, CURRENT_DATE, 'SYNTHETIC_TEST',$5)", [catalogueVersionId, orgId, centreId, catalogueItemId, staffId]);
  if ((await client.query("SELECT verification_status FROM diagnostic_catalogue_versions WHERE id = $1", [catalogueVersionId])).rows[0]?.verification_status !== "UNVERIFIED") throw new Error("Catalogue entries must begin unverified.");
  await client.query("UPDATE diagnostic_catalogue_versions SET verification_status='VERIFIED', price_source_reference='SYNTHETIC-SOURCE', reviewed_by_staff_id=$2, reviewed_at=now() WHERE id=$1", [catalogueVersionId, staffId]);
  await client.query("INSERT INTO catalogue_price_reviews (organization_id, centre_id, catalogue_version_id, decision, source_reference, effective_from, reviewed_by_staff_id, reason) VALUES ($1,$2,$3,'VERIFIED','SYNTHETIC-SOURCE',CURRENT_DATE,$4,'Synthetic source review')", [orgId, centreId, catalogueVersionId, staffId]);
  await client.query("UPDATE diagnostic_catalogue_items SET public_visible=true, public_visibility_updated_at=now(), public_visibility_updated_by_staff_id=$2 WHERE id=$1", [catalogueItemId, staffId]);
  const publicCatalogueRows = await client.query("SELECT item.id FROM diagnostic_catalogue_items item JOIN diagnostic_catalogue_versions version ON version.catalogue_item_id=item.id AND version.organization_id=item.organization_id AND version.centre_id=item.centre_id AND version.version_number=item.current_version JOIN centres centre ON centre.id=item.centre_id AND centre.organization_id=item.organization_id WHERE item.id=$1 AND centre.status='ACTIVE' AND item.active=true AND item.public_visible=true AND version.verification_status='VERIFIED' AND version.price_amount IS NOT NULL AND version.effective_from IS NOT NULL AND version.effective_from<=CURRENT_DATE AND (version.effective_until IS NULL OR version.effective_until>=CURRENT_DATE)", [catalogueItemId]);
  if (publicCatalogueRows.rowCount !== 1) throw new Error("Explicitly published, currently verified catalogue item was not eligible for the public directory.");
  let verifiedCatalogueMutationDenied = false; await client.query("SAVEPOINT verified_catalogue_immutable");
  try { await client.query("UPDATE diagnostic_catalogue_versions SET price_amount=1 WHERE id=$1", [catalogueVersionId]); } catch { verifiedCatalogueMutationDenied = true; await client.query("ROLLBACK TO SAVEPOINT verified_catalogue_immutable"); }
  if (!verifiedCatalogueMutationDenied) throw new Error("Verified catalogue version was mutable.");
  await client.query("INSERT INTO diagnostic_catalogue_items (id, organization_id, centre_id, service_type, service_code, current_version, created_by_staff_id) VALUES ($1,$2,$3,'PACKAGE',$4,1,$5)", [packageItemId, orgId, centreId, `P-${seed}`, staffId]);
  await client.query("INSERT INTO diagnostic_catalogue_versions (id, organization_id, centre_id, catalogue_item_id, version_number, display_name, verification_status, price_amount, source_type, created_by_staff_id) VALUES ($1,$2,$3,$4,1,'Synthetic package','UNVERIFIED',500,'SYNTHETIC_TEST',$5)", [packageVersionId, orgId, centreId, packageItemId, staffId]);
  const unverifiedPublicRows = await client.query("SELECT item.id FROM diagnostic_catalogue_items item JOIN diagnostic_catalogue_versions version ON version.catalogue_item_id=item.id AND version.organization_id=item.organization_id AND version.centre_id=item.centre_id AND version.version_number=item.current_version WHERE item.id=$1 AND item.public_visible=true AND version.verification_status='VERIFIED' AND version.price_amount IS NOT NULL AND version.effective_from IS NOT NULL AND version.effective_from<=CURRENT_DATE AND (version.effective_until IS NULL OR version.effective_until>=CURRENT_DATE)", [packageItemId]);
  if (unverifiedPublicRows.rowCount !== 0) throw new Error("Unverified catalogue record was exposed to the public directory.");
  await client.query("INSERT INTO diagnostic_package_components (organization_id, centre_id, package_version_id, test_version_id) VALUES ($1,$2,$3,$4)", [orgId, centreId, packageVersionId, catalogueVersionId]);
  await client.query("SAVEPOINT invalid_catalogue_component_type");
  let invalidCatalogueComponentTypeDenied = false;
  try { await client.query("INSERT INTO diagnostic_package_components (organization_id, centre_id, package_version_id, test_version_id) VALUES ($1,$2,$3,$4)", [orgId, centreId, catalogueVersionId, packageVersionId]); } catch { invalidCatalogueComponentTypeDenied = true; await client.query("ROLLBACK TO SAVEPOINT invalid_catalogue_component_type"); }
  if (!invalidCatalogueComponentTypeDenied) throw new Error("A test/package type mismatch was accepted in package components.");
  await client.query("SAVEPOINT cross_centre_catalogue_component");
  let crossCentreCatalogueLinkDenied = false;
  try { const otherCentre = await client.query("INSERT INTO centres (organization_id, code, name) VALUES ($1,$2,'Synthetic catalogue scope') RETURNING id", [orgId, `CAT-${seed}`]); await client.query("INSERT INTO diagnostic_package_components (organization_id, centre_id, package_version_id, test_version_id) VALUES ($1,$2,$3,$4)", [orgId, otherCentre.rows[0].id, packageVersionId, catalogueVersionId]); } catch { crossCentreCatalogueLinkDenied = true; await client.query("ROLLBACK TO SAVEPOINT cross_centre_catalogue_component"); }
  if (!crossCentreCatalogueLinkDenied) throw new Error("Cross-centre catalogue package component was accepted.");
  const pendingOrderId = randomUUID();
  await client.query("INSERT INTO diagnostic_orders (id, organization_id, centre_id, order_number, patient_id, status, idempotency_key, request_hash, created_by_staff_id) VALUES ($1,$2,$3,$4,$5,'PENDING_VERIFICATION',$6,$7,$8)", [pendingOrderId, orgId, centreId, `RHC-O-P-${seed}`, patientId, randomUUID(), "c".repeat(64), staffId]);
  await client.query("INSERT INTO diagnostic_order_items (organization_id, centre_id, order_id, catalogue_item_id, catalogue_version_id, service_type, service_code, display_name, verification_status, service_snapshot) VALUES ($1,$2,$3,$4,$5,'PACKAGE',$6,'Synthetic package','UNVERIFIED','{}'::jsonb)", [orgId, centreId, pendingOrderId, packageItemId, packageVersionId, `P-${seed}`]);
  const persistedPendingOrder = await client.query("SELECT o.status, i.price_amount FROM diagnostic_orders o JOIN diagnostic_order_items i ON i.order_id=o.id WHERE o.id=$1", [pendingOrderId]);
  if (persistedPendingOrder.rows[0]?.status !== "PENDING_VERIFICATION" || persistedPendingOrder.rows[0]?.price_amount !== null) throw new Error("An unverified catalogue candidate was attached as an order charge.");
  await client.query("UPDATE diagnostic_order_items SET removed_at=now(), removed_by_staff_id=$2, removal_reason='Synthetic draft update' WHERE order_id=$1", [pendingOrderId, staffId]);
  const retainedRemovedItem = await client.query("SELECT removed_at, removal_reason, price_amount FROM diagnostic_order_items WHERE order_id=$1", [pendingOrderId]);
  if (!retainedRemovedItem.rows[0]?.removed_at || retainedRemovedItem.rows[0]?.price_amount !== null) throw new Error("Draft item removal did not preserve a price-free service history row.");
  const confirmedOrderId = randomUUID();
  await client.query("INSERT INTO diagnostic_orders (id, organization_id, centre_id, order_number, patient_id, appointment_id, status, idempotency_key, request_hash, created_by_staff_id) VALUES ($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [confirmedOrderId, orgId, centreId, `RHC-O-C-${seed}`, patientId, appointmentId, randomUUID(), "d".repeat(64), staffId]);
  await client.query("INSERT INTO diagnostic_order_items (organization_id, centre_id, order_id, catalogue_item_id, catalogue_version_id, service_type, service_code, display_name, verification_status, price_amount, price_source_reference, effective_from, service_snapshot) VALUES ($1,$2,$3,$4,$5,'TEST',$6,'Synthetic test','VERIFIED',300,'SYNTHETIC-SOURCE',CURRENT_DATE,'{}'::jsonb)", [orgId, centreId, confirmedOrderId, catalogueItemId, catalogueVersionId, `T-${seed}`]);
  await client.query("UPDATE diagnostic_orders SET status='CONFIRMED', total_amount=300, confirmed_by_staff_id=$2, confirmed_at=now(), version_number=2 WHERE id=$1", [confirmedOrderId, staffId]);
  await client.query("INSERT INTO diagnostic_order_status_history (organization_id, centre_id, order_id, from_status, to_status, reason, version_number, actor_staff_id) VALUES ($1,$2,$3,'DRAFT','CONFIRMED','Synthetic verified order',2,$4)", [orgId, centreId, confirmedOrderId, staffId]);
  const reportId = randomUUID(); const reportNumber = `RHC-R-2099-${seed}`; const reportEventId = randomUUID(); const reportDocumentId = randomUUID(); const reportFollowupId = randomUUID();
  const reportPrivate=encryptOperationalValue("report-private",{externalReference:"SYNTHETIC-LAB-REF",holdReason:null},{organizationId:orgId,centreId,recordId:reportId});
  await client.query("INSERT INTO diagnostic_reports (id, organization_id, centre_id, patient_id, order_id, report_number, private_data_ciphertext, source, status, uploader_staff_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'METROPOLIS_REFERENCE','AWAITING_REPORT',$8)", [reportId, orgId, centreId, patientId, confirmedOrderId, reportNumber, reportPrivate, staffId]);
  const reportEventPrivate=encryptOperationalValue("report-event",{reason:"Synthetic intake only",evidenceReference:null},{organizationId:orgId,centreId,recordId:reportEventId});
  await client.query("INSERT INTO report_events (id, organization_id, centre_id, report_id, event_type, private_data_ciphertext, actor_staff_id) VALUES ($1,$2,$3,$4,'REGISTERED',$5,$6)", [reportEventId, orgId, centreId, reportId, reportEventPrivate, staffId]);
  await client.query("INSERT INTO report_documents (id, organization_id, centre_id, report_id, storage_key, original_filename, media_type, byte_size, sha256, scan_status, uploaded_by_staff_id, idempotency_key) VALUES ($1,$2,$3,$4,$5,'synthetic-report.pdf','application/pdf',128,$6,'QUARANTINED',$7,$8)", [reportDocumentId, orgId, centreId, reportId, `${randomUUID()}.pdf`, "a".repeat(64), staffId, randomUUID()]);
  if ((await client.query("SELECT status FROM diagnostic_reports WHERE id=$1", [reportId])).rows[0]?.status !== "AWAITING_REPORT") throw new Error("Synthetic report intake did not persist.");
  let unscannedReportReleaseDenied = false; await client.query("SAVEPOINT report_unscanned_release");
  try { await client.query("UPDATE diagnostic_reports SET status='VERIFIED',verified_by_staff_id=$2 WHERE id=$1", [reportId, staffId]); } catch { unscannedReportReleaseDenied = true; await client.query("ROLLBACK TO SAVEPOINT report_unscanned_release"); }
  if (!unscannedReportReleaseDenied) throw new Error("Report with an unavailable malware scan was allowed to verify.");
  let reportHistoryUpdateDenied = false; await client.query("SAVEPOINT immutable_report_history");
  try { await client.query("UPDATE report_events SET private_data_ciphertext='tampered' WHERE id=$1", [reportEventId]); } catch { reportHistoryUpdateDenied = true; await client.query("ROLLBACK TO SAVEPOINT immutable_report_history"); }
  if (!reportHistoryUpdateDenied) throw new Error("Report event update was accepted.");
  let reportDocumentDeleteDenied = false; await client.query("SAVEPOINT immutable_report_document");
  try { await client.query("DELETE FROM report_documents WHERE id=$1", [reportDocumentId]); } catch { reportDocumentDeleteDenied = true; await client.query("ROLLBACK TO SAVEPOINT immutable_report_document"); }
  if (!reportDocumentDeleteDenied) throw new Error("Report document metadata deletion was accepted.");
  const followupPrivate=encryptOperationalValue("report-followup",{outcome:null,outcomeNote:null},{organizationId:orgId,centreId,recordId:reportFollowupId});
  await client.query("INSERT INTO report_followups (id, organization_id, centre_id, report_id, assigned_staff_id, task_type, idempotency_key, due_at, created_by_staff_id, private_data_ciphertext) VALUES ($1,$2,$3,$4,$5,'REPORT_PENDING',$6,now()+interval '1 day',$5,$7)", [reportFollowupId, orgId, centreId, reportId, staffId, randomUUID(), followupPrivate]);
  const completedFollowupPrivate=encryptOperationalValue("report-followup",{outcome:"INTERNAL_REVIEWED",outcomeNote:null},{organizationId:orgId,centreId,recordId:reportFollowupId});
  await client.query("UPDATE report_followups SET status='COMPLETED',private_data_ciphertext=$3,completed_by_staff_id=$2,completed_at=now(),updated_at=now() WHERE id=$1", [reportFollowupId, staffId, completedFollowupPrivate]);
  if ((await client.query("SELECT status FROM report_followups WHERE id=$1", [reportFollowupId])).rows[0]?.status !== "COMPLETED") throw new Error("Synthetic report follow-up did not complete.");
  await client.query("SAVEPOINT confirmed_order_item_immutable");
  let confirmedOrderItemMutationDenied = false; try { await client.query("UPDATE diagnostic_order_items SET display_name='Tampered' WHERE order_id=$1", [confirmedOrderId]); } catch { confirmedOrderItemMutationDenied = true; await client.query("ROLLBACK TO SAVEPOINT confirmed_order_item_immutable"); }
  if (!confirmedOrderItemMutationDenied) throw new Error("Confirmed order snapshot was mutable.");
  await client.query("SAVEPOINT duplicate_order_idempotency");
  let duplicateOrderIdempotencyDenied = false;
  try { await client.query("INSERT INTO diagnostic_orders (organization_id, centre_id, order_number, patient_id, status, idempotency_key, request_hash, created_by_staff_id) VALUES ($1,$2,$3,$4,'DRAFT',$5,$6,$7)", [orgId, centreId, `RHC-O-DUP-${seed}`, patientId, (await client.query("SELECT idempotency_key FROM diagnostic_orders WHERE id=$1", [confirmedOrderId])).rows[0].idempotency_key, "e".repeat(64), staffId]); } catch { duplicateOrderIdempotencyDenied = true; await client.query("ROLLBACK TO SAVEPOINT duplicate_order_idempotency"); }
  if (!duplicateOrderIdempotencyDenied) throw new Error("Duplicate diagnostic order idempotency key was accepted.");
  await client.query("SAVEPOINT immutable_order_history");
  let orderHistoryMutationDenied = false; try { await client.query("UPDATE diagnostic_order_status_history SET reason='Tampered' WHERE order_id=$1", [confirmedOrderId]); } catch { orderHistoryMutationDenied = true; await client.query("ROLLBACK TO SAVEPOINT immutable_order_history"); }
  if (!orderHistoryMutationDenied) throw new Error("Diagnostic order status history was mutable.");
  const collectionJobId = randomUUID(); const collectionKey = randomUUID();
  await client.query("INSERT INTO collection_jobs (id, organization_id, centre_id, job_number, appointment_id, order_id, patient_id, status, assigned_staff_id, scheduled_start, scheduled_end, idempotency_key, created_by_staff_id) VALUES ($1,$2,$3,$4,$5,$6,$7,'ASSIGNED',$8,$9,$9::timestamptz + interval '30 minutes',$10,$8)", [collectionJobId, orgId, centreId, `RHC-C-${seed}`, appointmentId, confirmedOrderId, patientId, staffId, collectionAt, collectionKey]);
  const collectionCoverage = await client.query("SELECT count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM staff_shifts s WHERE s.organization_id=c.organization_id AND s.centre_id=c.centre_id AND s.staff_id=c.assigned_staff_id AND s.status='ACTIVE' AND s.shift_type='SCHEDULED' AND s.starts_at<=c.scheduled_start AND s.ends_at>=c.scheduled_end))::int AS outside, count(*) FILTER (WHERE EXISTS (SELECT 1 FROM staff_shifts s WHERE s.organization_id=c.organization_id AND s.centre_id=c.centre_id AND s.staff_id=c.assigned_staff_id AND s.status='ACTIVE' AND s.shift_type='UNAVAILABLE' AND s.starts_at<c.scheduled_end AND s.ends_at>c.scheduled_start))::int AS unavailable FROM collection_jobs c WHERE c.id=$1",[collectionJobId]);
  if (collectionCoverage.rows[0]?.outside !== 1 || collectionCoverage.rows[0]?.unavailable !== 1) throw new Error("Roster diagnostics did not identify collection outside roster and during recorded unavailability.");
  const collectionProcedureId = randomUUID(); const receivingProcedureId = randomUUID(); const packingProcedureId = randomUUID(); const transportProcedureId = randomUUID();
  for (const [procedureId, operation, reference] of [[collectionProcedureId, "COLLECTION", `SOP-C-${seed}`], [receivingProcedureId, "RECEIVING", `SOP-R-${seed}`], [packingProcedureId, "PACKING", `SOP-P-${seed}`], [transportProcedureId, "TRANSPORT", `SOP-T-${seed}`]]) await client.query("INSERT INTO sample_procedure_approvals (id, organization_id, centre_id, operation, reference, status, approved_by_staff_id) VALUES ($1,$2,$3,$4,$5,'ACTIVE',$6)", [procedureId, orgId, centreId, operation, reference, staffId]);
  const collectionEventId=randomUUID();await client.query("INSERT INTO collection_job_events (id,organization_id,centre_id,job_id,event_type,source,private_data_ciphertext,staff_id,actor_staff_id) VALUES ($1,$2,$3,$4,'ASSIGNED','STAFF',$5,$6,$6)", [collectionEventId,orgId,centreId,collectionJobId,encryptOperationalValue("collection-job-event",{reason:"Synthetic staff assignment",evidenceReference:null},{organizationId:orgId,centreId,recordId:collectionEventId}),staffId]);
  const specimenId = randomUUID(); const sampleIdempotencyKey = randomUUID();
  await client.query("INSERT INTO specimens (id,organization_id,centre_id,job_id,order_id,patient_id,specimen_number,idempotency_key,private_data_ciphertext,status,identity_check_confirmed,collection_procedure_approval_id,collected_by_staff_id,receiving_submission_required) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'COLLECTED',true,$10,$11,true)", [specimenId,orgId,centreId,collectionJobId,confirmedOrderId,patientId,`RHC-S-${seed}`,sampleIdempotencyKey,encryptOperationalValue("specimen",{specimenType:"Synthetic specimen",requirementReference:"SYNTHETIC-REQUIREMENT"},{organizationId:orgId,centreId,recordId:specimenId}),collectionProcedureId,staffId]);
  const custody = async (eventType, reason, evidenceReference=null, source="STAFF_RECORDED", eventIdempotencyKey=null) => {const eventId=randomUUID();await client.query("INSERT INTO sample_custody_events (id,organization_id,centre_id,specimen_id,event_type,source,private_data_ciphertext,actor_staff_id,idempotency_key) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",[eventId,orgId,centreId,specimenId,eventType,source,encryptOperationalValue("sample-custody-event",{reason,evidenceReference},{organizationId:orgId,centreId,recordId:eventId}),staffId,eventIdempotencyKey]);};
  await custody("COLLECTED","Synthetic collection event");
  const receivingQueueBeforeSubmission=await client.query("SELECT count(*)::int AS count FROM specimens s WHERE s.id=$1 AND s.receiving_submission_required=true AND EXISTS (SELECT 1 FROM sample_custody_events e WHERE e.organization_id=s.organization_id AND e.centre_id=s.centre_id AND e.specimen_id=s.id AND e.event_type='SUBMITTED_FOR_RECEIVING')",[specimenId]);
  if(receivingQueueBeforeSubmission.rows[0]?.count!==0)throw new Error("A newly collected specimen appeared in the receiving queue before collector submission.");
  const receivingSubmissionKey=randomUUID();
  await custody("SUBMITTED_FOR_RECEIVING","Synthetic collector handover submission",null,"STAFF_RECORDED",receivingSubmissionKey);
  const submittedSpecimen=await client.query("SELECT s.status, s.receiving_submission_required, count(e.id)::int AS submissions FROM specimens s LEFT JOIN sample_custody_events e ON e.organization_id=s.organization_id AND e.centre_id=s.centre_id AND e.specimen_id=s.id AND e.event_type='SUBMITTED_FOR_RECEIVING' WHERE s.id=$1 GROUP BY s.id",[specimenId]);
  if(submittedSpecimen.rows[0]?.status!=="COLLECTED"||submittedSpecimen.rows[0]?.receiving_submission_required!==true||submittedSpecimen.rows[0]?.submissions!==1)throw new Error("Collector handover submission changed physical custody state or failed to append exactly one event.");
  await client.query("SAVEPOINT duplicate_receiving_submission_key");let duplicateReceivingSubmissionKeyDenied=false;try{await custody("SUBMITTED_FOR_RECEIVING","Synthetic replay with duplicate key",null,"STAFF_RECORDED",receivingSubmissionKey);}catch{duplicateReceivingSubmissionKeyDenied=true;await client.query("ROLLBACK TO SAVEPOINT duplicate_receiving_submission_key");}if(!duplicateReceivingSubmissionKeyDenied)throw new Error("Duplicate sample custody idempotency key was accepted.");
  await client.query("SAVEPOINT duplicate_specimen_idempotency");
  let duplicateSpecimenIdempotencyDenied = false; try { const duplicateId=randomUUID();await client.query("INSERT INTO specimens (id,organization_id,centre_id,job_id,order_id,patient_id,specimen_number,idempotency_key,private_data_ciphertext,status,identity_check_confirmed,collection_procedure_approval_id,collected_by_staff_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'COLLECTED',true,$10,$11)", [duplicateId,orgId,centreId,collectionJobId,confirmedOrderId,patientId,`RHC-S-DUP-${seed}`,sampleIdempotencyKey,encryptOperationalValue("specimen",{specimenType:"Synthetic duplicate",requirementReference:"SYNTHETIC-REQUIREMENT"},{organizationId:orgId,centreId,recordId:duplicateId}),collectionProcedureId,staffId]); } catch { duplicateSpecimenIdempotencyDenied = true; await client.query("ROLLBACK TO SAVEPOINT duplicate_specimen_idempotency"); }
  if (!duplicateSpecimenIdempotencyDenied) throw new Error("Duplicate specimen collection idempotency key was accepted.");
  await client.query("UPDATE specimens SET status='RECEIVED_AT_RUDRA', received_by_staff_id=$2, received_at=now(), receiving_procedure_approval_id=$3, version_number=2, updated_at=now() WHERE id=$1", [specimenId, staffId, receivingProcedureId]);
  await custody("RECEIVED_AT_RUDRA","Synthetic Rudra receiving event");
  const batchId = randomUUID();
  await client.query("INSERT INTO dispatch_batches (id,organization_id,centre_id,batch_number,status,private_data_ciphertext,created_by_staff_id) VALUES ($1,$2,$3,$4,'PREPARING',$5,$6)", [batchId,orgId,centreId,`RHC-D-${seed}`,encryptOperationalValue("dispatch-batch",{carrierReference:null,externalLabReference:null},{organizationId:orgId,centreId,recordId:batchId}),staffId]);
  await client.query("INSERT INTO dispatch_batch_items (organization_id, centre_id, batch_id, specimen_id, added_by_staff_id) VALUES ($1,$2,$3,$4,$5)", [orgId, centreId, batchId, specimenId, staffId]);
  await client.query("UPDATE specimens SET status='PACKED', dispatch_batch_id=$2, version_number=3 WHERE id=$1", [specimenId, batchId]);
  await custody("PACKED","Synthetic packed event");
  await client.query("UPDATE dispatch_batches SET status='DISPATCHED',private_data_ciphertext=$4,handed_over_by_staff_id=$2,handed_over_at=now(),transport_procedure_approval_id=$3,version_number=2 WHERE id=$1", [batchId, staffId, transportProcedureId,encryptOperationalValue("dispatch-batch",{carrierReference:"SYNTHETIC-CARRIER",externalLabReference:"SYNTHETIC-EXT-REF"},{organizationId:orgId,centreId,recordId:batchId})]);
  await client.query("UPDATE specimens SET status='DISPATCHED', version_number=4 WHERE id=$1", [specimenId]);
  await custody("DISPATCHED","Synthetic dispatch handover","SYNTHETIC-CARRIER");
  const receiptId = randomUUID(); await client.query("INSERT INTO sample_external_receipts (id,organization_id,centre_id,batch_id,private_data_ciphertext,verification_status,recorded_by_staff_id,verified_by_staff_id,verified_at) VALUES ($1,$2,$3,$4,$5,'MANUALLY_VERIFIED',$6,$6,now())", [receiptId,orgId,centreId,batchId,encryptOperationalValue("sample-external-receipt",{receiptReference:"SYNTHETIC-RECEIPT",evidenceReference:"SYNTHETIC-EVIDENCE"},{organizationId:orgId,centreId,recordId:receiptId}),staffId]);
  await client.query("UPDATE dispatch_batches SET status='RECEIPT_RECORDED', version_number=3 WHERE id=$1", [batchId]);
  await client.query("UPDATE specimens SET status='EXTERNAL_RECEIPT_RECORDED', version_number=5 WHERE id=$1", [specimenId]);
  await custody("EXTERNAL_RECEIPT_RECORDED","Synthetic receipt evidence reviewed","SYNTHETIC-EVIDENCE","EXTERNAL_EVIDENCE");
  const custodyCount = await client.query("SELECT count(*)::int AS count FROM sample_custody_events WHERE specimen_id=$1", [specimenId]);
  if (custodyCount.rows[0]?.count !== 6 || (await client.query("SELECT status FROM specimens WHERE id=$1", [specimenId])).rows[0]?.status !== "EXTERNAL_RECEIPT_RECORDED") throw new Error("Synthetic sample custody sequence did not persist.");
  const financePolicy = await client.query("INSERT INTO finance_billing_policies (organization_id,centre_id,charge_type,issuer,updated_by_staff_id) VALUES ($1,$2,'DIAGNOSTIC','PENDING',$3) RETURNING legal_invoice_enabled", [orgId,centreId,staffId]);
  if (financePolicy.rows[0]?.legal_invoice_enabled !== false) throw new Error("Legal invoice issuance must remain disabled by default.");
  const financeChargeId=randomUUID();
  await client.query("INSERT INTO finance_charges (id,organization_id,centre_id,order_id,charge_type,charge_code,amount_minor,snapshot,recorded_by_staff_id,idempotency_key) VALUES ($1,$2,$3,$4,'DIAGNOSTIC','SYNTHETIC-ORDER',30000,'{\"invoiceIssuer\":\"PENDING\",\"legalInvoice\":false}'::jsonb,$5,$6)",[financeChargeId,orgId,centreId,confirmedOrderId,staffId,randomUUID()]);
  await client.query("INSERT INTO finance_charges (organization_id,centre_id,charge_type,charge_code,amount_minor,snapshot,recorded_by_staff_id,idempotency_key) SELECT $1,$2,'ADJUSTMENT','SYNTHETIC-BULK-'||n,100,'{}'::jsonb,$3,gen_random_uuid() FROM generate_series(1,205) AS n",[orgId,centreId,staffId]);
  const financePaymentId=randomUUID(), financePaymentKey=randomUUID();
  const financePaymentPrivate=encryptOperationalValue("finance-payment",{reference:null},{organizationId:orgId,centreId,recordId:financePaymentId});
  await client.query("INSERT INTO finance_payments (id,organization_id,centre_id,payment_number,method,status,amount_minor,private_data_ciphertext,received_by_staff_id,idempotency_key) VALUES ($1,$2,$3,$4,'CASH','RECORDED',20000,$5,$6,$7)",[financePaymentId,orgId,centreId,`RHC-P-${seed}`,financePaymentPrivate,staffId,financePaymentKey]);
  await client.query("INSERT INTO finance_allocations (organization_id,centre_id,payment_id,charge_id,amount_minor,allocated_by_staff_id) VALUES ($1,$2,$3,$4,20000,$5)",[orgId,centreId,financePaymentId,financeChargeId,staffId]);
  const financeSummary=await client.query("SELECT (SELECT count(*)::int FROM finance_payments WHERE organization_id=$1 AND centre_id=$2 AND status='RECORDED') AS pending_payments,(SELECT count(*)::int FROM finance_payments WHERE organization_id=$1 AND centre_id=$2 AND status='DISPUTED') AS disputed_payments,(SELECT count(*)::int FROM finance_refunds WHERE organization_id=$1 AND centre_id=$2 AND status='REQUESTED') AS refund_requests,(SELECT count(*)::int FROM finance_charges WHERE organization_id=$1 AND centre_id=$2 AND state='ACTIVE') AS active_charges,(SELECT COALESCE(sum(c.amount_minor+COALESCE((SELECT sum(a.amount_minor) FROM finance_adjustments a WHERE a.charge_id=c.id AND a.organization_id=c.organization_id),0)),0)::text FROM finance_charges c WHERE c.organization_id=$1 AND c.centre_id=$2 AND c.state='ACTIVE') AS active_charge_minor",[orgId,centreId]);
  if(financeSummary.rows[0]?.pending_payments!==1||financeSummary.rows[0]?.disputed_payments!==0||financeSummary.rows[0]?.refund_requests!==0||financeSummary.rows[0]?.active_charges!==206||financeSummary.rows[0]?.active_charge_minor!=="50500")throw new Error("Finance dashboard aggregates did not reflect the scoped authoritative ledger beyond the display page limit.");
  await client.query("UPDATE finance_payments SET status='CONFIRMED',version=2 WHERE id=$1",[financePaymentId]);
  const financeBalance=await client.query("SELECT c.amount_minor::text AS charge,COALESCE(sum(a.amount_minor),0)::text AS allocated FROM finance_charges c JOIN finance_allocations a ON a.charge_id=c.id JOIN finance_payments p ON p.id=a.payment_id WHERE c.id=$1 AND p.status='CONFIRMED' GROUP BY c.id",[financeChargeId]);
  if(financeBalance.rows[0]?.charge!=="30000"||financeBalance.rows[0]?.allocated!=="20000")throw new Error("Exact-minor-unit partial payment allocation failed.");
  const reversedPaymentId=randomUUID(),reversedPaymentPrivate=encryptOperationalValue("finance-payment",{reference:null},{organizationId:orgId,centreId,recordId:reversedPaymentId});await client.query("INSERT INTO finance_payments (id,organization_id,centre_id,payment_number,method,status,amount_minor,private_data_ciphertext,received_by_staff_id,idempotency_key) VALUES ($1,$2,$3,$4,'UPI','REVERSED',1000,$5,$6,$7)",[reversedPaymentId,orgId,centreId,`RHC-PR-${seed}`,reversedPaymentPrivate,staffId,randomUUID()]);const reversalEventId=randomUUID(),reversalPrivate=encryptOperationalValue("finance-event",{reason:"Synthetic reversal",evidenceReference:"SYNTHETIC-REVERSAL-EVIDENCE"},{organizationId:orgId,centreId,recordId:reversalEventId});await client.query("INSERT INTO finance_events (id,organization_id,centre_id,event_type,entity_type,entity_id,amount_minor,private_data_ciphertext,actor_staff_id) VALUES ($1,$2,$3,'PAYMENT_REVERSED','payment',$4,1000,$5,$6)",[reversalEventId,orgId,centreId,reversedPaymentId,reversalPrivate,staffId]);const persistedReversal=await client.query("SELECT private_data_ciphertext FROM finance_events WHERE entity_id=$1 AND event_type='PAYMENT_REVERSED'",[reversedPaymentId]);if(!persistedReversal.rows[0]?.private_data_ciphertext)throw new Error("Encrypted payment reversal evidence was not retained.");
  const financeReconciliationId=randomUUID(),reconciliationPrivate=encryptOperationalValue("finance-reconciliation",{reason:null},{organizationId:orgId,centreId,recordId:financeReconciliationId});await client.query("INSERT INTO finance_reconciliations (id,organization_id,centre_id,status,opened_by_staff_id,opening_cash_minor,private_data_ciphertext) VALUES ($1,$2,$3,'OPEN',$4,1000,$5)",[financeReconciliationId,orgId,centreId,staffId,reconciliationPrivate]);
  const secondAuthUserId=randomUUID(),secondStaffId=randomUUID();await client.query('INSERT INTO "user" (id,name,email,"emailVerified") VALUES ($1,$2,$3,true)',[secondAuthUserId,"Synthetic finance supervisor",`${seed.toLowerCase()}-finance@invalid.test`]);await client.query("INSERT INTO staff_users (id,auth_user_id,organization_id,staff_code,display_name,status) VALUES ($1,$2,$3,$4,'Synthetic finance supervisor','ACTIVE')",[secondStaffId,secondAuthUserId,orgId,`RHC-FIN-${seed}`]);
  const refundId=randomUUID(),refundPrivate=encryptOperationalValue("finance-refund",{reason:"Synthetic test refund",executionReference:null},{organizationId:orgId,centreId,recordId:refundId});await client.query("INSERT INTO finance_refunds (id,organization_id,centre_id,payment_id,amount_minor,private_data_ciphertext,status,requested_by_staff_id) VALUES ($1,$2,$3,$4,5000,$5,'REQUESTED',$6)",[refundId,orgId,centreId,financePaymentId,refundPrivate,staffId]);
  let selfRefundApprovalDenied=false;await client.query("SAVEPOINT finance_self_refund_approval");try{await client.query("UPDATE finance_refunds SET status='APPROVED',approved_by_staff_id=$2,approved_at=now() WHERE id=$1",[refundId,staffId]);}catch{selfRefundApprovalDenied=true;await client.query("ROLLBACK TO SAVEPOINT finance_self_refund_approval");}if(!selfRefundApprovalDenied)throw new Error("Refund requester was allowed to approve their own refund.");
  await client.query("UPDATE finance_refunds SET status='APPROVED',approved_by_staff_id=$2,approved_at=now() WHERE id=$1",[refundId,secondStaffId]);const executedRefundPrivate=encryptOperationalValue("finance-refund",{reason:"Synthetic test refund",executionReference:"SYNTHETIC-REFUND-EVIDENCE"},{organizationId:orgId,centreId,recordId:refundId});await client.query("UPDATE finance_refunds SET status='EXECUTION_RECORDED',private_data_ciphertext=$3,executed_by_staff_id=$2,executed_at=now() WHERE id=$1",[refundId,secondStaffId,executedRefundPrivate]);await client.query("UPDATE finance_payments SET status='PARTIALLY_REFUNDED',version=3 WHERE id=$1",[financePaymentId]);
  const expectedCash=1000+20000-5000;const variance=15000-expectedCash;const closedReconciliationPrivate=encryptOperationalValue("finance-reconciliation",{reason:"Synthetic counted variance"},{organizationId:orgId,centreId,recordId:financeReconciliationId});await client.query("UPDATE finance_reconciliations SET status='CLOSED',closed_by_staff_id=$2,closed_at=now(),expected_cash_minor=$3,counted_cash_minor=15000,variance_minor=$4,private_data_ciphertext=$5,version=2 WHERE id=$1",[financeReconciliationId,secondStaffId,expectedCash,variance,closedReconciliationPrivate]);
  const financeClosed=await client.query("SELECT expected_cash_minor::text AS expected,variance_minor::text AS variance FROM finance_reconciliations WHERE id=$1",[financeReconciliationId]);if(financeClosed.rows[0]?.expected!==String(expectedCash)||financeClosed.rows[0]?.variance!==String(variance))throw new Error("Cash reconciliation variance was not persisted accurately.");
  const paymentEventId=randomUUID(),paymentEventPrivate=encryptOperationalValue("finance-event",{reason:"Synthetic integration payment",evidenceReference:null},{organizationId:orgId,centreId,recordId:paymentEventId});await client.query("INSERT INTO finance_events (id,organization_id,centre_id,event_type,entity_type,entity_id,amount_minor,private_data_ciphertext,actor_staff_id) VALUES ($1,$2,$3,'PAYMENT_RECORDED','payment',$4,20000,$5,$6)",[paymentEventId,orgId,centreId,financePaymentId,paymentEventPrivate,staffId]);
  await client.query("SAVEPOINT immutable_finance_history");let financeHistoryMutationDenied=false;try{await client.query("UPDATE finance_events SET private_data_ciphertext='tampered' WHERE entity_id=$1",[financePaymentId]);}catch{financeHistoryMutationDenied=true;await client.query("ROLLBACK TO SAVEPOINT immutable_finance_history");}if(!financeHistoryMutationDenied)throw new Error("Financial event history was mutable.");
  let legalInvoiceEnableDenied=false;await client.query("SAVEPOINT legal_invoice_disabled");try{await client.query("UPDATE finance_billing_policies SET legal_invoice_enabled=true WHERE organization_id=$1 AND centre_id=$2",[orgId,centreId]);}catch{legalInvoiceEnableDenied=true;await client.query("ROLLBACK TO SAVEPOINT legal_invoice_disabled");}if(!legalInvoiceEnableDenied)throw new Error("Legal invoice issuance was enabled without approved policy.");
  const financePermissions=await client.query("SELECT key FROM permissions WHERE key=ANY($1::text[])",[["finance.read","finance.charge.create","finance.payment.record","finance.payment.verify","finance.adjustment.manage","finance.refund.request","finance.refund.approve","finance.refund.execute","finance.reconcile","finance.policy.manage"]]);if(financePermissions.rowCount!==10)throw new Error("Finance permissions were not registered.");
  await client.query("SAVEPOINT immutable_sample_custody");
  let sampleCustodyMutationDenied = false; try { await client.query("UPDATE sample_custody_events SET reason='Tampered' WHERE specimen_id=$1", [specimenId]); } catch { sampleCustodyMutationDenied = true; await client.query("ROLLBACK TO SAVEPOINT immutable_sample_custody"); }
  if (!sampleCustodyMutationDenied) throw new Error("Sample custody events were mutable.");
  await client.query("SAVEPOINT immutable_collection_events");
  let collectionEventMutationDenied = false; try { await client.query("DELETE FROM collection_job_events WHERE job_id=$1", [collectionJobId]); } catch { collectionEventMutationDenied = true; await client.query("ROLLBACK TO SAVEPOINT immutable_collection_events"); }
  if (!collectionEventMutationDenied) throw new Error("Collection job event history was mutable.");
  const samplePermissions = await client.query("SELECT key FROM permissions WHERE key = ANY($1::text[])", [["collections.read","collections.assign","collections.visit.record","samples.read","samples.collect","samples.receive","samples.dispatch","samples.external.verify","samples.exceptions.manage","samples.recollection.authorize","samples.procedures.manage"]]);
  if (samplePermissions.rowCount !== 11) throw new Error("Collection and sample permissions were not registered.");
  const orderPermissions = await client.query("SELECT key FROM permissions WHERE key = ANY($1::text[])", [["catalogue.read", "catalogue.manage", "catalogue.import", "catalogue.price.verify", "orders.read", "orders.create", "orders.confirm", "orders.cancel"]]);
  if (orderPermissions.rowCount !== 8) throw new Error("Catalogue and diagnostic order permissions were not registered.");
  await client.query("SAVEPOINT cross_centre_lead_conversion");
  let crossCentreLeadConversionDenied = false;
  try {
    await client.query("INSERT INTO lead_conversions (organization_id, centre_id, lead_id, patient_id, conversion_mode, converted_by_staff_id) VALUES ($1, $2, $3, $4, 'NEW', $5)", [orgId, centreId, leadId, secondPatientId, staffId]);
  } catch { crossCentreLeadConversionDenied = true; await client.query("ROLLBACK TO SAVEPOINT cross_centre_lead_conversion"); }
  if (!crossCentreLeadConversionDenied) throw new Error("Duplicate lead conversion was accepted.");
  await client.query("SAVEPOINT cross_centre_lead_scope");
  let crossCentreLeadScopeDenied = false;
  try {
    const otherCentreId = await client.query("INSERT INTO centres (organization_id, code, name) VALUES ($1, $2, $3) RETURNING id", [orgId, `LC-${seed}`, "Synthetic lead isolation centre"]);
    await client.query("INSERT INTO lead_activities (organization_id, centre_id, lead_id, actor_staff_id, activity_type) VALUES ($1, $2, $3, $4, 'CREATED')", [orgId, otherCentreId.rows[0].id, leadId, staffId]);
  } catch { crossCentreLeadScopeDenied = true; await client.query("ROLLBACK TO SAVEPOINT cross_centre_lead_scope"); }
  if (!crossCentreLeadScopeDenied) throw new Error("Cross-centre lead activity association was accepted.");
  await client.query("SAVEPOINT immutable_lead_activity");
  let leadActivityUpdateDenied = false;
  try { await client.query("UPDATE lead_activities SET activity_type = 'UPDATED' WHERE lead_id = $1", [leadId]); }
  catch { leadActivityUpdateDenied = true; await client.query("ROLLBACK TO SAVEPOINT immutable_lead_activity"); }
  if (!leadActivityUpdateDenied) throw new Error("Lead activity update was accepted.");
  const leadPermissions = await client.query("SELECT key FROM permissions WHERE key = ANY($1::text[])", [["leads.read", "leads.create", "leads.update", "leads.assign", "leads.convert", "leads.activities.write", "leads.followups.manage"]]);
  if (leadPermissions.rowCount !== 7) throw new Error("Lead CRM permission migration did not register all required permissions.");
  const patientPermissions = await client.query("SELECT key FROM permissions WHERE key = ANY($1::text[])", [["patients.read", "patients.create", "patients.update"]]);
  if (patientPermissions.rowCount !== 3) throw new Error("Patient permission migration did not register all required permissions.");
  await client.query("SAVEPOINT patient_cross_org_centre");
  let crossOrganizationPatientDenied = false;
  try {
    const otherCentre = await client.query("INSERT INTO centres (organization_id, code, name) VALUES ($1, $2, $3) RETURNING id", [otherOrgId, `PX-${seed}`, "Synthetic other organization centre"]);
    await client.query("INSERT INTO patients (organization_id, centre_id, patient_number, consent_status, consent_recorded_at, consent_method, created_by_staff_id) VALUES ($1, $2, $3, 'GRANTED', now(), 'IN_PERSON', $4)", [orgId, otherCentre.rows[0].id, `RHC-X-${seed}`, staffId]);
  } catch {
    crossOrganizationPatientDenied = true;
    await client.query("ROLLBACK TO SAVEPOINT patient_cross_org_centre");
  }
  if (!crossOrganizationPatientDenied) throw new Error("Cross-organization patient centre assignment was accepted.");
  await client.query("SAVEPOINT duplicate_patient_number");
  let duplicatePatientNumberDenied = false;
  try {
    await client.query("INSERT INTO patients (organization_id, centre_id, patient_number, consent_status, consent_recorded_at, consent_method, created_by_staff_id) VALUES ($1, $2, $3, 'GRANTED', now(), 'IN_PERSON', $4)", [orgId, centreId, patientNumber, staffId]);
  } catch {
    duplicatePatientNumberDenied = true;
    await client.query("ROLLBACK TO SAVEPOINT duplicate_patient_number");
  }
  if (!duplicatePatientNumberDenied) throw new Error("Duplicate patient number was accepted.");

  const familyId = randomUUID();
  await client.query("INSERT INTO families (id, organization_id, centre_id, family_number, display_name_ciphertext, display_name_blind_index, created_by_staff_id) VALUES ($1, $2, $3, $4, 'synthetic-ciphertext', $5, $6)", [familyId, orgId, centreId, `RHC-FAM-${seed}`, "9".repeat(64), staffId]);
  await client.query("SAVEPOINT cross_centre_family_membership");
  let crossCentreFamilyMembershipDenied = false;
  try {
    const otherCentreInOrganization = await client.query("INSERT INTO centres (organization_id, code, name) VALUES ($1, $2, $3) RETURNING id", [orgId, `FC-${seed}`, "Synthetic other centre"]);
    const otherCentrePatient = await client.query("INSERT INTO patients (organization_id, centre_id, patient_number, consent_status, consent_recorded_at, consent_method, created_by_staff_id) VALUES ($1, $2, $3, 'GRANTED', now(), 'IN_PERSON', $4) RETURNING id", [orgId, otherCentreInOrganization.rows[0].id, `RHC-2099-C-${seed}`, staffId]);
    await client.query("INSERT INTO family_members (organization_id, centre_id, family_id, patient_id, relationship, created_by_staff_id) VALUES ($1, $2, $3, $4, 'SIBLING', $5)", [orgId, centreId, familyId, otherCentrePatient.rows[0].id, staffId]);
  } catch {
    crossCentreFamilyMembershipDenied = true;
    await client.query("ROLLBACK TO SAVEPOINT cross_centre_family_membership");
  }
  if (!crossCentreFamilyMembershipDenied) throw new Error("Cross-centre family membership was accepted.");
  const memberId = randomUUID();
  await client.query("INSERT INTO family_members (id, organization_id, centre_id, family_id, patient_id, relationship, created_by_staff_id) VALUES ($1, $2, $3, $4, $5, 'SELF', $6)", [memberId, orgId, centreId, familyId, patientId, staffId]);
  await client.query("INSERT INTO family_members (organization_id, centre_id, family_id, patient_id, relationship, created_by_staff_id, status, authorization_basis, evidence_ciphertext, verified_by_staff_id, verified_at) VALUES ($1, $2, $3, $4, 'SIBLING', $5, 'ACTIVE', 'PATIENT_SELF', 'synthetic-evidence-ciphertext', $5, now())", [orgId, centreId, familyId, secondPatientId, staffId]);
  await client.query("SAVEPOINT duplicate_family_member");
  let duplicateFamilyMemberDenied = false;
  try {
    await client.query("INSERT INTO family_members (organization_id, centre_id, family_id, patient_id, relationship, created_by_staff_id) VALUES ($1, $2, $3, $4, 'SIBLING', $5)", [orgId, centreId, familyId, secondPatientId, staffId]);
  } catch {
    duplicateFamilyMemberDenied = true;
    await client.query("ROLLBACK TO SAVEPOINT duplicate_family_member");
  }
  if (!duplicateFamilyMemberDenied) throw new Error("Duplicate active family membership was accepted.");
  const grantId = randomUUID();
  await client.query("INSERT INTO family_access_grants (id, organization_id, centre_id, family_id, patient_id, grantee_patient_id, allowed_data, purpose_ciphertext, authorization_basis, created_by_staff_id) VALUES ($1, $2, $3, $4, $5, $6, '[\"APPOINTMENTS\"]'::jsonb, 'synthetic-purpose-ciphertext', 'PATIENT_SELF', $7)", [grantId, orgId, centreId, familyId, patientId, secondPatientId, staffId]);
  const pendingGrant = await client.query("SELECT status, evidence_ciphertext FROM family_access_grants WHERE id = $1", [grantId]);
  if (pendingGrant.rows[0]?.status !== "PENDING_VERIFICATION" || pendingGrant.rows[0]?.evidence_ciphertext !== null) throw new Error("Pending family sharing grant contains an active permission or evidence.");
  await client.query("UPDATE family_access_grants SET status = 'ACTIVE', evidence_ciphertext = 'synthetic-evidence-ciphertext', verified_by_staff_id = $2, verified_at = now() WHERE id = $1", [grantId, staffId]);
  const activeGrant = await client.query("SELECT status, allowed_data FROM family_access_grants WHERE id = $1", [grantId]);
  if (activeGrant.rows[0]?.status !== "ACTIVE" || JSON.stringify(activeGrant.rows[0]?.allowed_data) !== '["APPOINTMENTS"]') throw new Error("Explicit family sharing grant did not persist its verified, specific scope.");
  await client.query("UPDATE family_access_grants SET status = 'REVOKED', revoked_by_staff_id = $2, revoked_at = now() WHERE id = $1", [grantId, staffId]);
  if ((await client.query("SELECT status FROM family_access_grants WHERE id = $1", [grantId])).rows[0]?.status !== "REVOKED") throw new Error("Family sharing revocation did not persist.");
  const contactId = randomUUID();
  await client.query("INSERT INTO family_contact_arrangements (id, organization_id, centre_id, family_id, patient_id, channel, purpose, created_by_staff_id) VALUES ($1, $2, $3, $4, $5, 'PHONE', 'BOOKING_UPDATES', $6)", [contactId, orgId, centreId, familyId, secondPatientId, staffId]);
  if ((await client.query("SELECT status FROM family_contact_arrangements WHERE id = $1", [contactId])).rows[0]?.status !== "PENDING") throw new Error("Family contact arrangement must start pending.");
  await client.query("UPDATE family_contact_arrangements SET status = 'VERIFIED', authorization_basis = 'PATIENT_SELF', evidence_ciphertext = 'synthetic-evidence-ciphertext', verified_by_staff_id = $2, verified_at = now() WHERE id = $1", [contactId, staffId]);
  await client.query("UPDATE family_contact_arrangements SET status = 'REVOKED', revoked_by_staff_id = $2, revoked_at = now() WHERE id = $1", [contactId, staffId]);
  if ((await client.query("SELECT status FROM family_contact_arrangements WHERE id = $1", [contactId])).rows[0]?.status !== "REVOKED") throw new Error("Family contact revocation did not persist.");
  const familyPermissions = await client.query("SELECT key FROM permissions WHERE key = ANY($1::text[])", [["families.read", "families.create", "families.members.manage", "families.members.verify", "families.sharing.manage", "families.sharing.verify"]]);
  if (familyPermissions.rowCount !== 6) throw new Error("Family permissions migration did not register the expected permissions.");
  await client.query("INSERT INTO roles (id, organization_id, key, name, scope) VALUES ($1, $2, $3, $4, 'CENTRE')", [roleId, orgId, `role_${seed.toLowerCase()}`, "Synthetic role"]);
  await client.query("INSERT INTO permissions (id, key, description, scope) VALUES ($1, $2, $3, 'CENTRE')", [permissionId, `permission.${seed.toLowerCase()}`, "Synthetic test permission"]);
  await client.query("INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)", [roleId, permissionId]);
  await client.query("INSERT INTO staff_role_assignments (id, organization_id, staff_user_id, role_id, centre_id) VALUES ($1, $2, $3, $4, $5)", [assignmentId, orgId, staffId, roleId, centreId]);

  const approvalPolicyId = randomUUID();
  await client.query("INSERT INTO staff_approval_policies (id,organization_id,centre_id,action_type,enabled,escalation_after_minutes,escalation_owner_staff_id,expire_after_minutes,created_by_staff_id,updated_by_staff_id) VALUES ($1,$2,$3,'TASK_COMPLETION',true,60,$4,120,$4,$4)", [approvalPolicyId,orgId,centreId,staffId]);
  await client.query("INSERT INTO staff_approval_policy_approvers (organization_id,policy_id,staff_id,created_by_staff_id) VALUES ($1,$2,$3,$3)", [orgId,approvalPolicyId,staffId]);
  const persistedPolicy = await client.query("SELECT action_type,enabled,approver_permission,escalation_after_minutes,expire_after_minutes FROM staff_approval_policies WHERE id=$1 AND organization_id=$2 AND centre_id=$3", [approvalPolicyId,orgId,centreId]);
  if (persistedPolicy.rowCount !== 1 || persistedPolicy.rows[0].action_type !== "TASK_COMPLETION" || !persistedPolicy.rows[0].enabled || persistedPolicy.rows[0].approver_permission !== "tasks.approve" || persistedPolicy.rows[0].escalation_after_minutes !== 60 || persistedPolicy.rows[0].expire_after_minutes !== 120) throw new Error("Synthetic task approval policy did not persist its allowed action, approver permission, escalation and expiry deadlines.");
  await client.query("SAVEPOINT approval_policy_sensitive_action"); let sensitiveApprovalTypeDenied=false; try { await client.query("INSERT INTO staff_approval_policies (organization_id,centre_id,action_type,created_by_staff_id,updated_by_staff_id) VALUES ($1,$2,'REFUND_APPROVAL',$3,$3)",[orgId,centreId,staffId]); } catch { sensitiveApprovalTypeDenied=true; await client.query("ROLLBACK TO SAVEPOINT approval_policy_sensitive_action"); } if(!sensitiveApprovalTypeDenied)throw new Error("Unapproved sensitive approval type was accepted by the policy registry.");
  await client.query("SAVEPOINT approval_policy_cross_org_approver"); let crossOrganizationApproverDenied=false; try { await client.query("INSERT INTO staff_approval_policy_approvers (organization_id,policy_id,staff_id,created_by_staff_id) VALUES ($1,$2,$3,$4)",[otherOrgId,approvalPolicyId,staffId,staffId]); } catch { crossOrganizationApproverDenied=true; await client.query("ROLLBACK TO SAVEPOINT approval_policy_cross_org_approver"); } if(!crossOrganizationApproverDenied)throw new Error("Cross-organization approval policy approver was accepted.");
  const taskId = randomUUID();
  await client.query("INSERT INTO staff_tasks (id, organization_id, centre_id, task_number, private_data_ciphertext, task_type, status, requires_approval, approval_status, approval_policy_id, escalation_owner_staff_id, escalation_due_at, assigned_staff_id, created_by_staff_id, idempotency_key, request_hash) VALUES ($1,$2,$3,$4,'synthetic-encrypted-task','GENERAL','AWAITING_APPROVAL',true,'PENDING',$5,$6,now()-interval '1 minute',$6,$6,$7,$8)", [taskId, orgId, centreId, `T-${seed}`, approvalPolicyId, staffId, randomUUID(), "a".repeat(64)]);
  const supportTaskId = randomUUID();
  await client.query("INSERT INTO staff_tasks (id, organization_id, centre_id, task_number, private_data_ciphertext, task_type, status, requires_approval, approval_status, assigned_staff_id, created_by_staff_id, idempotency_key, request_hash) VALUES ($1,$2,$3,$4,'synthetic-encrypted-support-task','SUPPORT_REQUEST','OPEN',false,'NOT_REQUIRED',$5,$5,$6,$7)", [supportTaskId, orgId, centreId, `S-${seed}`, staffId, randomUUID(), "s".repeat(64)]);
  const supportTaskType = await client.query("SELECT task_type FROM staff_tasks WHERE id=$1 AND organization_id=$2 AND centre_id=$3", [supportTaskId, orgId, centreId]);
  if (supportTaskType.rows[0]?.task_type !== "SUPPORT_REQUEST") throw new Error("Support request task type did not persist after migration replay.");
  const supportPermissions = await client.query("SELECT count(*)::int AS count FROM permissions WHERE key = ANY($1::text[])", [["tasks.support.read", "tasks.support.create", "tasks.support.manage"]]);
  if (supportPermissions.rows[0]?.count !== 3) throw new Error("Scoped support-task permissions are missing.");
  await client.query("SAVEPOINT invalid_support_task_type"); let invalidSupportTaskTypeDenied=false; try { await client.query("UPDATE staff_tasks SET task_type='INVALID' WHERE id=$1", [supportTaskId]); } catch { invalidSupportTaskTypeDenied=true; await client.query("ROLLBACK TO SAVEPOINT invalid_support_task_type"); } if(!invalidSupportTaskTypeDenied)throw new Error("Invalid staff task type bypassed the task type constraint.");
  const escalationMarkerStartsNull = await client.query("SELECT escalation_processed_at IS NULL AS is_null FROM staff_tasks WHERE id=$1", [taskId]);
  if (escalationMarkerStartsNull.rows[0]?.is_null !== true) throw new Error("New task escalation marker did not default to null.");
  await client.query("UPDATE staff_tasks SET escalation_processed_at=now() WHERE id=$1", [taskId]);
  const escalationMarkerPersists = await client.query("SELECT escalation_processed_at IS NOT NULL AS processed FROM staff_tasks WHERE id=$1", [taskId]);
  if (escalationMarkerPersists.rows[0]?.processed !== true) throw new Error("Task escalation processing marker did not persist.");
  const overdueApproval = await client.query("SELECT count(*)::int AS count FROM staff_tasks WHERE id=$1 AND status='AWAITING_APPROVAL' AND escalation_due_at<=now() AND escalation_owner_staff_id=$2",[taskId,staffId]); if(overdueApproval.rows[0]?.count!==1)throw new Error("An overdue task approval was not discoverable in the escalation queue.");
  const disputedPaymentId = randomUUID();
  await client.query("INSERT INTO finance_payments (id,organization_id,centre_id,payment_number,method,status,amount_minor,received_by_staff_id,idempotency_key,private_data_ciphertext) VALUES ($1,$2,$3,$4,'UPI','DISPUTED',12500,$5,$6,'synthetic-private-finance-payload')", [disputedPaymentId,orgId,centreId,`P-${seed}-${disputedPaymentId.slice(0,8)}`,staffId,randomUUID()]);
  const requestedRefundId = randomUUID();
  await client.query("INSERT INTO finance_refunds (id,organization_id,centre_id,payment_id,amount_minor,status,requested_by_staff_id,private_data_ciphertext) VALUES ($1,$2,$3,$4,2500,'REQUESTED',$5,'synthetic-private-refund-payload')", [requestedRefundId,orgId,centreId,disputedPaymentId,staffId]);
  for (const [sourceType,sourceId] of [["FINANCE_PAYMENT",disputedPaymentId],["FINANCE_REFUND",requestedRefundId]]) {
    const escalationId = randomUUID();
    await client.query("INSERT INTO staff_escalations (id,organization_id,centre_id,escalation_number,source_type,source_id,private_data_ciphertext,severity,priority,assigned_owner_staff_id,created_by_staff_id,due_at,idempotency_key,request_hash) VALUES ($1,$2,$3,$4,$5,$6,'synthetic-encrypted-escalation','MODERATE','NORMAL',$7,$7,now()+interval '1 day',$8,$9)", [escalationId,orgId,centreId,`RHC-E-${new Date().getFullYear()}-${escalationId.slice(0,8).toUpperCase()}`,sourceType,sourceId,staffId,randomUUID(),"e".repeat(64)]);
  }
  const financialEscalationSources = await client.query("SELECT count(*)::int AS count FROM staff_escalations WHERE organization_id=$1 AND centre_id=$2 AND source_type IN ('FINANCE_PAYMENT','FINANCE_REFUND') AND source_id=ANY($3::uuid[])",[orgId,centreId,[disputedPaymentId,requestedRefundId]]);
  if (financialEscalationSources.rows[0]?.count !== 2) throw new Error("Financial exception escalation sources did not persist.");
  const taskEscalationId = randomUUID();
  await client.query("INSERT INTO staff_escalations (id,organization_id,centre_id,escalation_number,source_type,source_id,private_data_ciphertext,severity,priority,assigned_owner_staff_id,created_by_staff_id,due_at,idempotency_key,request_hash) VALUES ($1,$2,$3,$4,'STAFF_TASK',$5,'synthetic-encrypted-task-escalation','MODERATE','NORMAL',$6,$6,now()+interval '1 day',$7,$8)", [taskEscalationId,orgId,centreId,`RHC-E-${new Date().getFullYear()}-${taskEscalationId.slice(0,8).toUpperCase()}`,taskId,staffId,randomUUID(),"t".repeat(64)]);
  const taskEscalationSource = await client.query("SELECT source_id FROM staff_escalations WHERE id=$1 AND organization_id=$2 AND centre_id=$3 AND source_type='STAFF_TASK'",[taskEscalationId,orgId,centreId]);
  if (taskEscalationSource.rowCount !== 1 || taskEscalationSource.rows[0]?.source_id !== taskId) throw new Error("Synthetic staff-task escalation source did not persist with its task reference.");
  const mutationKey = randomUUID();
  const mutationRequestHash = "a".repeat(64);
  const mutationEventId = randomUUID();
  await client.query("INSERT INTO staff_escalation_events (id,organization_id,centre_id,escalation_id,event_type,private_data_ciphertext,actor_staff_id,idempotency_key,request_hash) VALUES ($1,$2,$3,$4,'ACKNOWLEDGED','synthetic-encrypted-mutation-result',$5,$6,$7)", [mutationEventId,orgId,centreId,taskEscalationId,staffId,mutationKey,mutationRequestHash]);
  const replayRecord = await client.query("SELECT escalation_id,request_hash FROM staff_escalation_events WHERE organization_id=$1 AND idempotency_key=$2", [orgId,mutationKey]);
  if (replayRecord.rowCount !== 1 || replayRecord.rows[0]?.escalation_id !== taskEscalationId || replayRecord.rows[0]?.request_hash !== mutationRequestHash) throw new Error("Synthetic escalation mutation idempotency record did not persist.");
  await client.query("SAVEPOINT duplicate_escalation_action_key");
  let duplicateEscalationActionKeyDenied = false;
  try { await client.query("INSERT INTO staff_escalation_events (id,organization_id,centre_id,escalation_id,event_type,private_data_ciphertext,actor_staff_id,idempotency_key,request_hash) VALUES ($1,$2,$3,$4,'ACKNOWLEDGED','synthetic-encrypted-duplicate',$5,$6,$7)", [randomUUID(),orgId,centreId,taskEscalationId,staffId,mutationKey,mutationRequestHash]); }
  catch { duplicateEscalationActionKeyDenied = true; await client.query("ROLLBACK TO SAVEPOINT duplicate_escalation_action_key"); }
  if (!duplicateEscalationActionKeyDenied) throw new Error("Duplicate escalation mutation key was accepted.");
  const suppressedCreateKey = randomUUID();
  const suppressedCreateHash = "b".repeat(64);
  const suppressedCreateEventId = randomUUID();
  await client.query("INSERT INTO staff_escalation_events (id,organization_id,centre_id,escalation_id,event_type,private_data_ciphertext,actor_staff_id,idempotency_key,request_hash) VALUES ($1,$2,$3,$4,'DUPLICATE_SUPPRESSED','synthetic-encrypted-suppression-result',$5,$6,$7)", [suppressedCreateEventId,orgId,centreId,taskEscalationId,staffId,suppressedCreateKey,suppressedCreateHash]);
  const suppressedCreateReplay = await client.query("SELECT escalation_id,request_hash,event_type FROM staff_escalation_events WHERE organization_id=$1 AND idempotency_key=$2", [orgId,suppressedCreateKey]);
  if (suppressedCreateReplay.rowCount !== 1 || suppressedCreateReplay.rows[0]?.escalation_id !== taskEscalationId || suppressedCreateReplay.rows[0]?.request_hash !== suppressedCreateHash || suppressedCreateReplay.rows[0]?.event_type !== "DUPLICATE_SUPPRESSED") throw new Error("Synthetic duplicate-escalation suppression receipt did not persist for idempotent replay.");
  const taskEventId = randomUUID();
  await client.query("INSERT INTO staff_task_events (id, organization_id, centre_id, task_id, event_type, private_data_ciphertext, actor_staff_id) VALUES ($1,$2,$3,$4,'CREATED','synthetic-encrypted-event',$5)", [taskEventId, orgId, centreId, taskId, staffId]);
  const escalationEventId = randomUUID();
  await client.query("INSERT INTO staff_task_events (id, organization_id, centre_id, task_id, event_type, private_data_ciphertext, actor_staff_id) VALUES ($1,$2,$3,$4,'ESCALATED','synthetic-encrypted-escalation-event',$5)", [escalationEventId, orgId, centreId, taskId, staffId]);
  const escalationEventSaved = await client.query("SELECT event_type FROM staff_task_events WHERE id=$1 AND task_id=$2 AND organization_id=$3 AND centre_id=$4", [escalationEventId, taskId, orgId, centreId]);
  if (escalationEventSaved.rowCount !== 1 || escalationEventSaved.rows[0]?.event_type !== "ESCALATED") throw new Error("An authorized synthetic task escalation event did not persist.");
  await client.query("UPDATE staff_tasks SET status='IN_PROGRESS',approval_status='EXPIRED',approval_expires_at=NULL,escalation_owner_staff_id=NULL,escalation_due_at=NULL WHERE id=$1 AND organization_id=$2", [taskId,orgId]);
  const expiredTask = await client.query("SELECT status,approval_status FROM staff_tasks WHERE id=$1 AND organization_id=$2", [taskId,orgId]);
  if (expiredTask.rowCount !== 1 || expiredTask.rows[0]?.status !== "IN_PROGRESS" || expiredTask.rows[0]?.approval_status !== "EXPIRED") throw new Error("Synthetic approval expiry state did not persist.");
  const expiryEventId = randomUUID();
  await client.query("INSERT INTO staff_task_events (id, organization_id, centre_id, task_id, event_type, private_data_ciphertext, actor_staff_id) VALUES ($1,$2,$3,$4,'APPROVAL_EXPIRED','synthetic-encrypted-expiry-event',$5)", [expiryEventId, orgId, centreId, taskId, staffId]);
  const expiryEventSaved = await client.query("SELECT event_type FROM staff_task_events WHERE id=$1 AND task_id=$2 AND organization_id=$3 AND centre_id=$4", [expiryEventId, taskId, orgId, centreId]);
  if (expiryEventSaved.rowCount !== 1 || expiryEventSaved.rows[0]?.event_type !== "APPROVAL_EXPIRED") throw new Error("Synthetic approval expiry event did not persist.");
  await client.query("SAVEPOINT immutable_staff_task_event");
  let taskEventMutationDenied = false;
  try { await client.query("UPDATE staff_task_events SET event_type='UPDATED' WHERE id=$1", [taskEventId]); } catch { taskEventMutationDenied = true; await client.query("ROLLBACK TO SAVEPOINT immutable_staff_task_event"); }
  if (!taskEventMutationDenied) throw new Error("Staff task history was mutable.");
  const shiftId = randomUUID();
  await client.query("INSERT INTO staff_shifts (id, organization_id, centre_id, staff_id, shift_type, starts_at, ends_at, time_zone, private_data_ciphertext, created_by_staff_id, idempotency_key, request_hash) VALUES ($1,$2,$3,$4,'SCHEDULED',now()+interval '1 day',now()+interval '1 day 8 hours','Asia/Kolkata','synthetic-encrypted-shift',$4,$5,$6)", [shiftId, orgId, centreId, staffId, randomUUID(), "c".repeat(64)]);
  const shiftEventId = randomUUID();
  await client.query("INSERT INTO staff_shift_events (id, organization_id, centre_id, shift_id, event_type, private_data_ciphertext, actor_staff_id) VALUES ($1,$2,$3,$4,'CREATED','synthetic-encrypted-event',$5)", [shiftEventId, orgId, centreId, shiftId, staffId]);
  await client.query("SAVEPOINT immutable_staff_shift_event");
  let shiftEventMutationDenied = false;
  try { await client.query("DELETE FROM staff_shift_events WHERE id=$1", [shiftEventId]); } catch { shiftEventMutationDenied = true; await client.query("ROLLBACK TO SAVEPOINT immutable_staff_shift_event"); }
  if (!shiftEventMutationDenied) throw new Error("Staff roster history was deletable.");

  await client.query("SAVEPOINT invalid_scope");
  let crossOrganizationDenied = false;
  try {
    await client.query("INSERT INTO staff_role_assignments (id, organization_id, staff_user_id, role_id, centre_id) VALUES ($1, $2, $3, $4, $5)", [randomUUID(), otherOrgId, staffId, roleId, centreId]);
  } catch {
    crossOrganizationDenied = true;
    await client.query("ROLLBACK TO SAVEPOINT invalid_scope");
  }
  if (!crossOrganizationDenied) throw new Error("Cross-organization role assignment was accepted.");

  await client.query("SAVEPOINT invalid_centre_scope");
  let crossOrganizationCentreDenied = false;
  try {
    await client.query("INSERT INTO staff_role_assignments (id, organization_id, staff_user_id, role_id, centre_id) VALUES ($1, $2, $3, $4, $5)", [randomUUID(), orgId, staffId, roleId, await (async () => {
      const result = await client.query("INSERT INTO centres (organization_id, code, name) VALUES ($1, $2, $3) RETURNING id", [otherOrgId, `X-${seed}`, "Synthetic other organization centre"]);
      return result.rows[0].id;
    })()]);
  } catch {
    crossOrganizationCentreDenied = true;
    await client.query("ROLLBACK TO SAVEPOINT invalid_centre_scope");
  }
  if (!crossOrganizationCentreDenied) throw new Error("Cross-organization centre assignment was accepted.");

  await client.query("SAVEPOINT duplicate_assignment");
  let duplicateAssignmentDenied = false;
  try {
    await client.query("INSERT INTO staff_role_assignments (id, organization_id, staff_user_id, role_id, centre_id) VALUES ($1, $2, $3, $4, $5)", [randomUUID(), orgId, staffId, roleId, centreId]);
  } catch {
    duplicateAssignmentDenied = true;
    await client.query("ROLLBACK TO SAVEPOINT duplicate_assignment");
  }
  if (!duplicateAssignmentDenied) throw new Error("Duplicate active role assignment was accepted.");

  const auditEvent = {
    id: auditId,
    organizationId: orgId,
    centreId: null,
    actorStaffId: staffId,
    action: "test.insert",
    entityType: "test",
    entityId: null,
    details: { synthetic: true },
    recordedAt: new Date(),
  };
  const auditHash = computeAuditEventHash(auditEvent, GENESIS_AUDIT_HASH);
  await client.query("INSERT INTO audit_events (id, organization_id, actor_staff_id, action, entity_type, details, previous_hash, event_hash, recorded_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)", [auditEvent.id, auditEvent.organizationId, auditEvent.actorStaffId, auditEvent.action, auditEvent.entityType, JSON.stringify(auditEvent.details), GENESIS_AUDIT_HASH, auditHash, auditEvent.recordedAt]);
  const persistedAudit = await client.query("SELECT id::text AS id, organization_id::text AS \"organizationId\", centre_id::text AS \"centreId\", actor_staff_id::text AS \"actorStaffId\", action, entity_type AS \"entityType\", entity_id AS \"entityId\", details, previous_hash AS \"previousHash\", event_hash AS \"eventHash\", recorded_at AS \"recordedAt\" FROM audit_events WHERE id = $1", [auditId]);
  const auditVerification = verifyAuditChain(persistedAudit.rows);
  if (!auditVerification.valid || auditVerification.verifiedEvents !== 1) throw new Error("Synthetic audit event hash chain did not verify.");
  await client.query("SAVEPOINT audit_tenant_mismatch");
  let auditTenantMismatchDenied = false;
  try {
    await client.query("INSERT INTO audit_events (id, organization_id, actor_staff_id, action, entity_type, details, previous_hash, event_hash) VALUES ($1, $2, $3, 'test.insert', 'test', '{}'::jsonb, $4, $5)", [randomUUID(), otherOrgId, staffId, "0".repeat(64), "b".repeat(64)]);
  } catch {
    auditTenantMismatchDenied = true;
    await client.query("ROLLBACK TO SAVEPOINT audit_tenant_mismatch");
  }
  if (!auditTenantMismatchDenied) throw new Error("Cross-organization audit actor was accepted.");
  await client.query("SAVEPOINT immutable_audit");
  let auditUpdateDenied = false;
  try {
    await client.query("UPDATE audit_events SET action = 'tampered' WHERE id = $1", [auditId]);
  } catch {
    auditUpdateDenied = true;
    await client.query("ROLLBACK TO SAVEPOINT immutable_audit");
  }
  if (!auditUpdateDenied) throw new Error("Audit event update was accepted.");
  await client.query("SAVEPOINT immutable_audit_delete");
  let auditDeleteDenied = false;
  try {
    await client.query("DELETE FROM audit_events WHERE id = $1", [auditId]);
  } catch {
    auditDeleteDenied = true;
    await client.query("ROLLBACK TO SAVEPOINT immutable_audit_delete");
  }
  if (!auditDeleteDenied) throw new Error("Audit event deletion was accepted.");
  await client.query("ROLLBACK");
  console.log(`Database integration checks passed: ${replay.total} migration(s) replayed; synthetic credential/MFA, patient/family/lead/appointment, catalogue/order, collection/sample, financial charge/payment/allocation/reversal/refund/reconciliation/variance, report quarantine/follow-up, encrypted website-content version storage, append-only history, RBAC and audit verification passed.`);
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}

const runtimeUrl = process.env.DATABASE_URL;
if (!runtimeUrl || !/^postgres(?:ql)?:\/\//i.test(runtimeUrl)) throw new Error("DATABASE_URL is required to verify runtime access to patient tables.");
const runtimePool = new Pool({ connectionString: runtimeUrl, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-health-os-patient-runtime-check" });
try {
  const runtime = await runtimePool.query(`SELECT current_database() AS database, current_user AS runtime_role,
    has_table_privilege('patients', 'SELECT') AS patient_read,
    has_table_privilege('patients', 'INSERT') AS patient_create,
    has_table_privilege('patients', 'UPDATE') AS patient_update,
    has_table_privilege('patient_contact_secrets', 'SELECT') AS patient_contact_read,
    has_table_privilege('patient_contact_secrets', 'INSERT') AS patient_contact_create,
    has_table_privilege('patient_contact_secrets', 'UPDATE') AS patient_contact_update,
    has_table_privilege('patient_contact_secrets', 'DELETE') AS patient_contact_delete,
    has_table_privilege('patient_relationships', 'SELECT') AS relationship_read,
    has_table_privilege('families', 'SELECT') AS family_read,
    has_table_privilege('families', 'INSERT') AS family_create,
    has_table_privilege('family_members', 'SELECT') AS family_member_read,
    has_table_privilege('family_access_grants', 'INSERT') AS family_grant_create,
    has_table_privilege('family_contact_arrangements', 'INSERT') AS family_contact_create,
    has_table_privilege('families', 'DELETE') AS family_delete,
    has_table_privilege('family_members', 'DELETE') AS family_member_delete,
    has_table_privilege('family_access_grants', 'DELETE') AS family_grant_delete,
    has_table_privilege('family_contact_arrangements', 'DELETE') AS family_contact_delete,
    has_table_privilege('leads', 'SELECT') AS lead_read,
    has_table_privilege('leads', 'INSERT') AS lead_create,
    has_table_privilege('leads', 'UPDATE') AS lead_update,
    has_table_privilege('leads', 'DELETE') AS lead_delete,
    has_table_privilege('lead_activities', 'INSERT') AS lead_activity_append,
    has_table_privilege('lead_activities', 'UPDATE') AS lead_activity_update,
    has_table_privilege('lead_activities', 'DELETE') AS lead_activity_delete,
    has_table_privilege('lead_followups', 'INSERT') AS lead_followup_create,
    has_table_privilege('lead_followups', 'UPDATE') AS lead_followup_update,
    has_table_privilege('lead_followups', 'DELETE') AS lead_followup_delete,
    has_table_privilege('lead_conversions', 'INSERT') AS lead_conversion_create,
    has_table_privilege('lead_conversions', 'UPDATE') AS lead_conversion_update,
    has_table_privilege('lead_conversions', 'DELETE') AS lead_conversion_delete,
     has_table_privilege('appointments', 'SELECT') AS appointment_read,
     has_table_privilege('appointments', 'INSERT') AS appointment_create,
     has_table_privilege('appointments', 'UPDATE') AS appointment_update,
     has_table_privilege('appointments', 'DELETE') AS appointment_delete,
     has_table_privilege('appointment_services', 'INSERT') AS appointment_service_create,
     has_table_privilege('appointment_status_history', 'INSERT') AS appointment_history_append,
     has_table_privilege('appointment_status_history', 'UPDATE') AS appointment_history_update,
     has_table_privilege('appointment_assignment_history', 'INSERT') AS appointment_assignment_append,
     has_table_privilege('appointment_assignment_history', 'DELETE') AS appointment_assignment_delete,
    has_table_privilege('diagnostic_catalogue_items', 'SELECT') AS catalogue_read,
    has_table_privilege('diagnostic_catalogue_items', 'INSERT') AS catalogue_create,
    has_table_privilege('diagnostic_catalogue_items', 'DELETE') AS catalogue_delete,
    has_table_privilege('diagnostic_catalogue_versions', 'INSERT') AS catalogue_version_create,
    has_table_privilege('diagnostic_catalogue_versions', 'UPDATE') AS catalogue_version_update,
    has_table_privilege('diagnostic_order_items', 'INSERT') AS order_item_create,
    has_table_privilege('diagnostic_order_items', 'UPDATE') AS order_item_update,
    has_table_privilege('diagnostic_order_items', 'DELETE') AS order_item_delete,
    has_table_privilege('diagnostic_order_status_history', 'INSERT') AS order_history_append,
    has_table_privilege('diagnostic_order_status_history', 'UPDATE') AS order_history_update,
    has_table_privilege('diagnostic_order_status_history', 'DELETE') AS order_history_delete,
    has_table_privilege('diagnostic_orders', 'INSERT') AS order_create,
    has_table_privilege('diagnostic_orders', 'UPDATE') AS order_update,
     has_table_privilege('diagnostic_orders', 'DELETE') AS order_delete,
    has_table_privilege('collection_jobs', 'SELECT') AS collection_job_read,
    has_table_privilege('collection_jobs', 'INSERT') AS collection_job_create,
    has_table_privilege('collection_jobs', 'UPDATE') AS collection_job_update,
    has_table_privilege('collection_jobs', 'DELETE') AS collection_job_delete,
    has_table_privilege('collection_job_events', 'INSERT') AS collection_event_append,
    has_table_privilege('collection_job_events', 'UPDATE') AS collection_event_update,
    has_table_privilege('collection_job_events', 'DELETE') AS collection_event_delete,
    has_table_privilege('sample_procedure_approvals', 'INSERT') AS sample_procedure_create,
    has_table_privilege('specimens', 'SELECT') AS specimen_read,
    has_table_privilege('specimens', 'INSERT') AS specimen_create,
    has_table_privilege('specimens', 'UPDATE') AS specimen_update,
    has_table_privilege('specimens', 'DELETE') AS specimen_delete,
    has_table_privilege('sample_custody_events', 'INSERT') AS custody_append,
    has_table_privilege('sample_custody_events', 'UPDATE') AS custody_update,
    has_table_privilege('sample_custody_events', 'DELETE') AS custody_delete,
    has_table_privilege('dispatch_batches', 'INSERT') AS batch_create,
    has_table_privilege('dispatch_batch_items', 'INSERT') AS batch_item_create,
    has_table_privilege('dispatch_batch_items', 'DELETE') AS batch_item_delete,
    has_table_privilege('sample_external_receipts', 'INSERT') AS external_receipt_create,
    has_table_privilege('sample_external_receipts', 'UPDATE') AS external_receipt_update,
    has_table_privilege('sample_external_receipts', 'DELETE') AS external_receipt_delete,
    has_table_privilege('finance_charges', 'SELECT') AS finance_charge_read,
    has_table_privilege('finance_charges', 'INSERT') AS finance_charge_create,
    has_table_privilege('finance_charges', 'UPDATE') AS finance_charge_update,
    has_table_privilege('finance_charges', 'DELETE') AS finance_charge_delete,
    has_table_privilege('finance_payments', 'SELECT') AS finance_payment_read,
    has_table_privilege('finance_payments', 'INSERT') AS finance_payment_create,
    has_table_privilege('finance_payments', 'UPDATE') AS finance_payment_update,
    has_table_privilege('finance_allocations', 'INSERT') AS finance_allocation_create,
    has_table_privilege('finance_allocations', 'UPDATE') AS finance_allocation_update,
    has_table_privilege('finance_allocations', 'DELETE') AS finance_allocation_delete,
    has_table_privilege('finance_adjustments', 'INSERT') AS finance_adjustment_create,
    has_table_privilege('finance_adjustments', 'UPDATE') AS finance_adjustment_update,
    has_table_privilege('finance_adjustments', 'DELETE') AS finance_adjustment_delete,
    has_table_privilege('finance_refunds', 'INSERT') AS finance_refund_create,
    has_table_privilege('finance_refunds', 'UPDATE') AS finance_refund_update,
    has_table_privilege('finance_refunds', 'DELETE') AS finance_refund_delete,
    has_table_privilege('finance_events', 'INSERT') AS finance_event_append,
    has_table_privilege('finance_events', 'SELECT') AS finance_event_read,
    has_table_privilege('finance_events', 'UPDATE') AS finance_event_update,
    has_table_privilege('finance_events', 'DELETE') AS finance_event_delete,
    has_table_privilege('finance_billing_policies', 'SELECT') AS finance_policy_read,
    has_table_privilege('finance_adjustments', 'SELECT') AS finance_adjustment_read,
    has_table_privilege('finance_refunds', 'SELECT') AS finance_refund_read,
    has_table_privilege('finance_reconciliations', 'SELECT') AS finance_reconciliation_read,
    has_table_privilege('finance_reconciliations', 'INSERT') AS finance_reconciliation_create,
    has_table_privilege('finance_reconciliations', 'UPDATE') AS finance_reconciliation_update,
    has_table_privilege('finance_reconciliations', 'DELETE') AS finance_reconciliation_delete,
    has_table_privilege('diagnostic_reports', 'SELECT') AS report_read,
    has_table_privilege('diagnostic_reports', 'INSERT') AS report_create,
    has_table_privilege('diagnostic_reports', 'UPDATE') AS report_update,
    has_table_privilege('diagnostic_reports', 'DELETE') AS report_delete,
    has_table_privilege('report_documents', 'SELECT') AS report_document_read,
    has_table_privilege('report_documents', 'INSERT') AS report_document_create,
    has_table_privilege('report_documents', 'UPDATE') AS report_document_update,
    has_table_privilege('report_documents', 'DELETE') AS report_document_delete,
    has_table_privilege('report_events', 'INSERT') AS report_event_append,
    has_table_privilege('report_events', 'UPDATE') AS report_event_update,
    has_table_privilege('report_events', 'DELETE') AS report_event_delete,
    has_table_privilege('report_followups', 'SELECT') AS report_followup_read,
    has_table_privilege('report_followups', 'INSERT') AS report_followup_create,
    has_table_privilege('report_followups', 'UPDATE') AS report_followup_update,
    has_table_privilege('report_followups', 'DELETE') AS report_followup_delete,
    has_table_privilege('report_followup_events', 'INSERT') AS report_followup_event_append,
    has_table_privilege('report_followup_events', 'UPDATE') AS report_followup_event_update,
    has_table_privilege('report_followup_events', 'DELETE') AS report_followup_event_delete,
    has_table_privilege('staff_tasks', 'SELECT') AS staff_task_read,
    has_table_privilege('staff_tasks', 'INSERT') AS staff_task_create,
    has_table_privilege('staff_tasks', 'UPDATE') AS staff_task_update,
    has_table_privilege('staff_tasks', 'DELETE') AS staff_task_delete,
    has_table_privilege('staff_approval_policies', 'SELECT') AS approval_policy_read,
    has_table_privilege('staff_approval_policies', 'INSERT') AS approval_policy_create,
    has_table_privilege('staff_approval_policies', 'UPDATE') AS approval_policy_update,
    has_table_privilege('staff_approval_policies', 'DELETE') AS approval_policy_delete,
    has_table_privilege('staff_approval_policy_approvers', 'SELECT') AS approval_policy_approver_read,
    has_table_privilege('staff_approval_policy_approvers', 'INSERT') AS approval_policy_approver_create,
    has_table_privilege('staff_approval_policy_approvers', 'UPDATE') AS approval_policy_approver_update,
    has_table_privilege('staff_approval_policy_approvers', 'DELETE') AS approval_policy_approver_delete,
    has_table_privilege('appointment_arrival_events', 'SELECT') AS appointment_arrival_read,
    has_table_privilege('appointment_arrival_events', 'INSERT') AS appointment_arrival_create,
    has_table_privilege('appointment_arrival_events', 'UPDATE') AS appointment_arrival_update,
    has_table_privilege('appointment_arrival_events', 'DELETE') AS appointment_arrival_delete,
    has_table_privilege('appointment_queue_tokens', 'SELECT') AS appointment_queue_read,
    has_table_privilege('appointment_queue_tokens', 'INSERT') AS appointment_queue_create,
    has_table_privilege('appointment_queue_tokens', 'UPDATE') AS appointment_queue_update,
    has_table_privilege('appointment_queue_tokens', 'DELETE') AS appointment_queue_delete,
    has_table_privilege('appointment_queue_events', 'SELECT') AS appointment_queue_event_read,
    has_table_privilege('appointment_queue_events', 'INSERT') AS appointment_queue_event_append,
    has_table_privilege('appointment_queue_events', 'UPDATE') AS appointment_queue_event_update,
    has_table_privilege('appointment_queue_events', 'DELETE') AS appointment_queue_event_delete,
    has_table_privilege('staff_task_events', 'SELECT') AS staff_task_event_read,
    has_table_privilege('staff_task_events', 'INSERT') AS staff_task_event_append,
    has_table_privilege('staff_task_events', 'UPDATE') AS staff_task_event_update,
    has_table_privilege('staff_task_events', 'DELETE') AS staff_task_event_delete,
    has_table_privilege('staff_shifts', 'SELECT') AS staff_shift_read,
    has_table_privilege('staff_shifts', 'INSERT') AS staff_shift_create,
    has_table_privilege('staff_shifts', 'UPDATE') AS staff_shift_update,
    has_table_privilege('staff_shifts', 'DELETE') AS staff_shift_delete,
    has_table_privilege('staff_shift_events', 'SELECT') AS staff_shift_event_read,
    has_table_privilege('staff_shift_events', 'INSERT') AS staff_shift_event_append,
    has_table_privilege('staff_shift_events', 'UPDATE') AS staff_shift_event_update,
    has_table_privilege('staff_shift_events', 'DELETE') AS staff_shift_event_delete,
    has_table_privilege('audit_events', 'INSERT') AS audit_append`);
  const grant = runtime.rows[0];
  const doctorPrivileges = await runtimePool.query(`SELECT current_user AS runtime_role,
    has_table_privilege('doctor_profiles','SELECT') AS profile_read,
    has_table_privilege('doctor_profiles','INSERT') AS profile_create,
    has_table_privilege('doctor_profiles','UPDATE') AS profile_update,
    has_table_privilege('doctor_profiles','DELETE') AS profile_delete,
    has_table_privilege('doctor_relationship_events','SELECT') AS event_read,
    has_table_privilege('doctor_relationship_events','INSERT') AS event_append,
    has_table_privilege('doctor_relationship_events','UPDATE') AS event_update,
    has_table_privilege('doctor_relationship_events','DELETE') AS event_delete`);
  const doctorGrant = doctorPrivileges.rows[0];
  if (!doctorGrant.profile_read || !doctorGrant.profile_create || !doctorGrant.profile_update || doctorGrant.profile_delete || !doctorGrant.event_read || !doctorGrant.event_append || doctorGrant.event_update || doctorGrant.event_delete) throw new Error('Doctor profile and append-only relationship-event privileges do not match least-privilege rules.');
  const relationshipPrivileges = await runtimePool.query(`SELECT current_user AS runtime_role,
    has_table_privilege('business_relationships','SELECT') AS profile_read,
    has_table_privilege('business_relationships','INSERT') AS profile_create,
    has_table_privilege('business_relationships','UPDATE') AS profile_update,
    has_table_privilege('business_relationships','DELETE') AS profile_delete,
    has_table_privilege('business_relationship_events','SELECT') AS event_read,
    has_table_privilege('business_relationship_events','INSERT') AS event_append,
    has_table_privilege('business_relationship_events','UPDATE') AS event_update,
    has_table_privilege('business_relationship_events','DELETE') AS event_delete`);
  const relationshipGrant = relationshipPrivileges.rows[0];
  if (!relationshipGrant.profile_read || !relationshipGrant.profile_create || !relationshipGrant.profile_update || relationshipGrant.profile_delete || !relationshipGrant.event_read || !relationshipGrant.event_append || relationshipGrant.event_update || relationshipGrant.event_delete) throw new Error('Business relationship and append-only event privileges do not match least-privilege rules.');
  const centrePublicProfilePrivileges = await runtimePool.query(`SELECT
    has_table_privilege('centre_public_profiles','SELECT') AS profile_read,
    has_table_privilege('centre_public_profiles','INSERT') AS profile_create,
    has_table_privilege('centre_public_profiles','UPDATE') AS profile_update,
    has_table_privilege('centre_public_profiles','DELETE') AS profile_delete`);
  const centrePublicProfileGrant = centrePublicProfilePrivileges.rows[0];
  if (!centrePublicProfileGrant.profile_read || !centrePublicProfileGrant.profile_create || !centrePublicProfileGrant.profile_update || centrePublicProfileGrant.profile_delete) throw new Error('Centre public profile privileges do not match least-privilege rules.');
  if (/test/i.test(grant.database) || !grant.patient_read || !grant.patient_create || !grant.patient_update || !grant.patient_contact_read || !grant.patient_contact_create || !grant.patient_contact_update || grant.patient_contact_delete || !grant.relationship_read || !grant.family_read || !grant.family_create || !grant.family_member_read || !grant.family_grant_create || !grant.family_contact_create || grant.family_delete || grant.family_member_delete || grant.family_grant_delete || grant.family_contact_delete || !grant.lead_read || !grant.lead_create || !grant.lead_update || grant.lead_delete || !grant.lead_activity_append || grant.lead_activity_update || grant.lead_activity_delete || !grant.lead_followup_create || !grant.lead_followup_update || grant.lead_followup_delete || !grant.lead_conversion_create || grant.lead_conversion_update || grant.lead_conversion_delete || !grant.appointment_read || !grant.appointment_create || !grant.appointment_update || grant.appointment_delete || !grant.appointment_service_create || !grant.appointment_history_append || grant.appointment_history_update || !grant.appointment_assignment_append || grant.appointment_assignment_delete || !grant.catalogue_read || !grant.catalogue_create || grant.catalogue_delete || !grant.catalogue_version_create || !grant.catalogue_version_update || !grant.order_item_create || !grant.order_item_update || grant.order_item_delete || !grant.order_history_append || grant.order_history_update || grant.order_history_delete || !grant.order_create || !grant.order_update || grant.order_delete || !grant.collection_job_read || !grant.collection_job_create || !grant.collection_job_update || grant.collection_job_delete || !grant.collection_event_append || grant.collection_event_update || grant.collection_event_delete || !grant.sample_procedure_create || !grant.specimen_read || !grant.specimen_create || !grant.specimen_update || grant.specimen_delete || !grant.custody_append || grant.custody_update || grant.custody_delete || !grant.batch_create || !grant.batch_item_create || grant.batch_item_delete || !grant.external_receipt_create || grant.external_receipt_update || grant.external_receipt_delete || !grant.finance_charge_read || !grant.finance_charge_create || grant.finance_charge_update || grant.finance_charge_delete || !grant.finance_payment_read || !grant.finance_payment_create || !grant.finance_payment_update || !grant.finance_allocation_create || grant.finance_allocation_update || grant.finance_allocation_delete || !grant.finance_adjustment_create || !grant.finance_adjustment_read || grant.finance_adjustment_update || grant.finance_adjustment_delete || !grant.finance_refund_create || !grant.finance_refund_read || !grant.finance_refund_update || grant.finance_refund_delete || !grant.finance_event_append || !grant.finance_event_read || grant.finance_event_update || grant.finance_event_delete || !grant.finance_policy_read || !grant.finance_reconciliation_read || !grant.finance_reconciliation_create || !grant.finance_reconciliation_update || grant.finance_reconciliation_delete || !grant.report_read || !grant.report_create || !grant.report_update || grant.report_delete || !grant.report_document_read || !grant.report_document_create || grant.report_document_update || grant.report_document_delete || !grant.report_event_append || grant.report_event_update || grant.report_event_delete || !grant.report_followup_read || !grant.report_followup_create || !grant.report_followup_update || grant.report_followup_delete || !grant.report_followup_event_append || grant.report_followup_event_update || grant.report_followup_event_delete || !grant.audit_append) {
    throw new Error("Runtime application role privilege matrix did not match the expected least-privilege rules.");
  }
  if (!grant.staff_task_read || !grant.staff_task_create || !grant.staff_task_update || grant.staff_task_delete || !grant.staff_task_event_read || !grant.staff_task_event_append || grant.staff_task_event_update || grant.staff_task_event_delete || !grant.staff_shift_read || !grant.staff_shift_create || !grant.staff_shift_update || grant.staff_shift_delete || !grant.staff_shift_event_read || !grant.staff_shift_event_append || grant.staff_shift_event_update || grant.staff_shift_event_delete || !grant.approval_policy_read || !grant.approval_policy_create || !grant.approval_policy_update || grant.approval_policy_delete || !grant.approval_policy_approver_read || !grant.approval_policy_approver_create || grant.approval_policy_approver_update || !grant.approval_policy_approver_delete || !grant.appointment_arrival_read || !grant.appointment_arrival_create || grant.appointment_arrival_update || grant.appointment_arrival_delete || !grant.appointment_queue_read || !grant.appointment_queue_create || !grant.appointment_queue_update || grant.appointment_queue_delete || !grant.appointment_queue_event_read || !grant.appointment_queue_event_append || grant.appointment_queue_event_update || grant.appointment_queue_event_delete) throw new Error(`Runtime task, approval, arrival, walk-in queue and roster privilege matrix did not match least-privilege rules: ${JSON.stringify({ role: grant.runtime_role, tokenRead: grant.appointment_queue_read, tokenCreate: grant.appointment_queue_create, tokenUpdate: grant.appointment_queue_update, tokenDelete: grant.appointment_queue_delete, eventRead: grant.appointment_queue_event_read, eventAppend: grant.appointment_queue_event_append, eventUpdate: grant.appointment_queue_event_update, eventDelete: grant.appointment_queue_event_delete })}`);
  await runtimePool.query("BEGIN");
  await runtimePool.query("SELECT set_config('rudra.finance_report_key_rotation','on',true)");
  let runtimeRotationWriteDenied = false;
  try { await runtimePool.query("UPDATE finance_events SET private_data_ciphertext=private_data_ciphertext WHERE false"); }
  catch (error) {
    const pgCode = error && typeof error === "object" ? error.code : undefined;
    runtimeRotationWriteDenied = pgCode === "42501";
    await runtimePool.query("ROLLBACK");
  }
  if (!runtimeRotationWriteDenied) {
    await runtimePool.query("ROLLBACK").catch(() => {});
    throw new Error("Runtime database role could use the finance/report key-rotation context to attempt history updates.");
  }
  await runtimePool.query("BEGIN");
  await runtimePool.query("SELECT set_config('rudra.lead_sensitive_key_rotation','on',true)");
  let runtimeLeadRotationWriteDenied = false;
  try { await runtimePool.query("UPDATE lead_activities SET private_payload_ciphertext=private_payload_ciphertext WHERE false"); }
  catch (error) {
    const pgCode = error && typeof error === "object" ? error.code : undefined;
    runtimeLeadRotationWriteDenied = pgCode === "42501";
    await runtimePool.query("ROLLBACK");
  }
  if (!runtimeLeadRotationWriteDenied) {
    await runtimePool.query("ROLLBACK").catch(() => {});
    throw new Error("Runtime database role could use the lead-history key-rotation context to attempt append-only history updates.");
  }
  const escalationPrivileges = await runtimePool.query(`SELECT current_user AS runtime_role,
    has_table_privilege('staff_escalations','SELECT') AS escalation_read,
    has_table_privilege('staff_escalations','INSERT') AS escalation_create,
    has_table_privilege('staff_escalations','UPDATE') AS escalation_update,
    has_table_privilege('staff_escalations','DELETE') AS escalation_delete,
    has_table_privilege('staff_escalation_events','SELECT') AS escalation_event_read,
    has_table_privilege('staff_escalation_events','INSERT') AS escalation_event_append,
    has_table_privilege('staff_escalation_events','UPDATE') AS escalation_event_update,
    has_table_privilege('staff_escalation_events','DELETE') AS escalation_event_delete`);
  const escalationGrant = escalationPrivileges.rows[0];
  if (!escalationGrant.escalation_read || !escalationGrant.escalation_create || !escalationGrant.escalation_update || escalationGrant.escalation_delete || !escalationGrant.escalation_event_read || !escalationGrant.escalation_event_append || escalationGrant.escalation_event_update || escalationGrant.escalation_event_delete) throw new Error("Runtime escalation privilege matrix did not match least-privilege rules.");
  const publicEnquiryPrivileges = await runtimePool.query(`SELECT current_user AS runtime_role,
    has_table_privilege('public_enquiries','SELECT') AS enquiry_read,
    has_table_privilege('public_enquiries','INSERT') AS enquiry_create,
    has_table_privilege('public_enquiries','UPDATE') AS enquiry_review,
    has_table_privilege('public_enquiries','DELETE') AS enquiry_delete,
    has_table_privilege('public_enquiry_events','SELECT') AS event_read,
    has_table_privilege('public_enquiry_events','INSERT') AS event_append,
    has_table_privilege('public_enquiry_events','UPDATE') AS event_update,
    has_table_privilege('public_enquiry_events','DELETE') AS event_delete`);
  const enquiryGrant = publicEnquiryPrivileges.rows[0];
  if (!enquiryGrant.enquiry_read || !enquiryGrant.enquiry_create || !enquiryGrant.enquiry_review || enquiryGrant.enquiry_delete || !enquiryGrant.event_read || !enquiryGrant.event_append || enquiryGrant.event_update || enquiryGrant.event_delete) throw new Error("Runtime public-enquiry privilege matrix did not match least-privilege rules.");
  const websiteContentPrivileges = await runtimePool.query(`SELECT
    has_table_privilege('website_content_pages','SELECT') AS page_read,
    has_table_privilege('website_content_pages','INSERT') AS page_create,
    has_table_privilege('website_content_pages','UPDATE') AS page_update,
    has_table_privilege('website_content_pages','DELETE') AS page_delete,
    has_table_privilege('website_content_events','SELECT') AS event_read,
    has_table_privilege('website_content_events','INSERT') AS event_append,
    has_table_privilege('website_content_events','UPDATE') AS event_update,
    has_table_privilege('website_content_events','DELETE') AS event_delete`);
  const websiteGrant = websiteContentPrivileges.rows[0];
  if (!websiteGrant.page_read || !websiteGrant.page_create || !websiteGrant.page_update || websiteGrant.page_delete || !websiteGrant.event_read || !websiteGrant.event_append || websiteGrant.event_update || websiteGrant.event_delete) throw new Error("Runtime website-content privilege matrix did not match least-privilege rules.");
  const websiteVersionPrivileges = await runtimePool.query(`SELECT
    has_table_privilege('website_content_versions','SELECT') AS version_read,
    has_table_privilege('website_content_versions','INSERT') AS version_append,
    has_table_privilege('website_content_versions','UPDATE') AS version_update,
    has_table_privilege('website_content_versions','DELETE') AS version_delete`);
  const websiteVersionGrant = websiteVersionPrivileges.rows[0];
  if (!websiteVersionGrant.version_read || !websiteVersionGrant.version_append || websiteVersionGrant.version_update || websiteVersionGrant.version_delete) throw new Error("Runtime website-content version privilege matrix did not match append-only rules.");
  const communicationDraftPrivileges = await runtimePool.query(`SELECT
    has_table_privilege('lead_communication_drafts','SELECT') AS draft_read,
    has_table_privilege('lead_communication_drafts','INSERT') AS draft_create,
    has_table_privilege('lead_communication_drafts','UPDATE') AS draft_update,
    has_table_privilege('lead_communication_drafts','DELETE') AS draft_delete,
    has_table_privilege('lead_communication_draft_events','INSERT') AS event_append,
    has_table_privilege('lead_communication_draft_events','UPDATE') AS event_update,
    has_table_privilege('lead_communication_draft_events','DELETE') AS event_delete`);
  const draftGrant = communicationDraftPrivileges.rows[0];
  if (!draftGrant.draft_read || !draftGrant.draft_create || !draftGrant.draft_update || draftGrant.draft_delete || !draftGrant.event_append || draftGrant.event_update || draftGrant.event_delete) throw new Error("Runtime communication-draft privilege matrix did not match least-privilege rules.");
  const communicationTemplatePrivileges = await runtimePool.query(`SELECT
    has_table_privilege('communication_templates','SELECT') AS template_read,
    has_table_privilege('communication_templates','INSERT') AS template_create,
    has_table_privilege('communication_templates','UPDATE') AS template_update,
    has_table_privilege('communication_templates','DELETE') AS template_delete,
    has_table_privilege('communication_template_events','INSERT') AS event_append,
    has_table_privilege('communication_template_events','UPDATE') AS event_update,
    has_table_privilege('communication_template_events','DELETE') AS event_delete`);
  const templateGrant = communicationTemplatePrivileges.rows[0];
  if (!templateGrant.template_read || !templateGrant.template_create || !templateGrant.template_update || templateGrant.template_delete || !templateGrant.event_append || templateGrant.event_update || templateGrant.event_delete) throw new Error("Runtime communication-template privilege matrix did not match least-privilege rules.");
  const campaignPrivileges = await runtimePool.query(`SELECT
    has_table_privilege('marketing_campaigns','SELECT') AS campaign_read,
    has_table_privilege('marketing_campaigns','INSERT') AS campaign_create,
    has_table_privilege('marketing_campaigns','UPDATE') AS campaign_update,
    has_table_privilege('marketing_campaigns','DELETE') AS campaign_delete,
    has_table_privilege('marketing_campaign_events','INSERT') AS event_append,
    has_table_privilege('marketing_campaign_events','UPDATE') AS event_update,
    has_table_privilege('marketing_campaign_events','DELETE') AS event_delete`);
  const campaignGrant = campaignPrivileges.rows[0];
  if (!campaignGrant.campaign_read || !campaignGrant.campaign_create || !campaignGrant.campaign_update || campaignGrant.campaign_delete || !campaignGrant.event_append || campaignGrant.event_update || campaignGrant.event_delete) throw new Error("Runtime campaign and append-only event privileges do not match least-privilege rules.");
  const marketingContentPrivileges = await runtimePool.query(`SELECT
    has_table_privilege('marketing_content_items','SELECT') AS item_read,
    has_table_privilege('marketing_content_items','INSERT') AS item_create,
    has_table_privilege('marketing_content_items','UPDATE') AS item_update,
    has_table_privilege('marketing_content_items','DELETE') AS item_delete,
    has_table_privilege('marketing_content_events','INSERT') AS event_append,
    has_table_privilege('marketing_content_events','UPDATE') AS event_update,
    has_table_privilege('marketing_content_events','DELETE') AS event_delete`);
  const contentGrant = marketingContentPrivileges.rows[0];
  if (!contentGrant.item_read || !contentGrant.item_create || !contentGrant.item_update || contentGrant.item_delete || !contentGrant.event_append || contentGrant.event_update || contentGrant.event_delete) throw new Error("Runtime marketing content and append-only event privileges do not match least-privilege rules.");
  console.log("Runtime-role check passed: development database privileges support patient/family/lead/communication-draft/communication-template/marketing-campaign/marketing-content-calendar/public-enquiry/website-content/appointment/walk-in queue/catalogue/order/collection/finance/report/task/approval/roster/escalation/doctor/corporate/partner operations; relationship and append-only histories reject mutation and delete grants.");
} finally {
  await runtimePool.end();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = 0;
