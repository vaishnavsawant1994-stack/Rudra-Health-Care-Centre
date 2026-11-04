import { relations, sql } from "drizzle-orm";
import { boolean, date, foreignKey, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid, varchar, bigint } from "drizzle-orm/pg-core";
import { authAccount, authSession, authUser } from "./auth-schema";

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const recordedAt = () => timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow();

export const staffStatus = pgEnum("staff_status", ["INVITED", "ACTIVE", "SUSPENDED", "REVOKED"]);
export const roleScope = pgEnum("role_scope", ["ORGANIZATION", "CENTRE"]);
export const patientConsentStatus = pgEnum("patient_consent_status", ["NOT_RECORDED", "GRANTED", "DECLINED", "WITHDRAWN"]);

export const organizations = pgTable("organizations", {
  id: id(),
  code: varchar("code", { length: 32 }).notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  legalName: varchar("legal_name", { length: 240 }),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("organizations_code_uq").on(table.code), uniqueIndex("organizations_id_code_uq").on(table.id, table.code)]);

export const centres = pgTable("centres", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  code: varchar("code", { length: 32 }).notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  address: jsonb("address").$type<Record<string, string>>(),
  timeZone: varchar("time_zone", { length: 64 }).notNull().default("Asia/Kolkata"),
  status: varchar("status", { length: 20 }).notNull().default("ACTIVE"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("centres_org_code_uq").on(table.organizationId, table.code), uniqueIndex("centres_id_org_uq").on(table.id, table.organizationId), index("centres_org_idx").on(table.organizationId)]);

export const centrePublicProfiles = pgTable("centre_public_profiles", {
  id: id(),
  organizationId: uuid("organization_id").notNull(),
  centreId: uuid("centre_id").notNull(),
  profileCiphertext: text("profile_ciphertext").notNull(),
  published: boolean("published").notNull().default(false),
  versionNumber: integer("version_number").notNull().default(1),
  createdByStaffId: uuid("created_by_staff_id").notNull(),
  updatedByStaffId: uuid("updated_by_staff_id").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("centre_public_profiles_centre_uq").on(table.organizationId, table.centreId),
  foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "centre_public_profiles_centre_fk" }),
  foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "centre_public_profiles_creator_fk" }),
  foreignKey({ columns: [table.updatedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "centre_public_profiles_updater_fk" }),
  index("centre_public_profiles_public_idx").on(table.published, table.organizationId, table.centreId),
]);

export const staffUsers = pgTable("staff_users", {
  id: id(),
  authUserId: text("auth_user_id").notNull().references(() => authUser.id, { onDelete: "restrict" }),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  staffCode: varchar("staff_code", { length: 32 }).notNull(),
  displayName: varchar("display_name", { length: 180 }).notNull(),
  status: staffStatus("status").notNull().default("INVITED"),
  isOwner: boolean("is_owner").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("staff_auth_user_uq").on(table.authUserId),
  uniqueIndex("staff_org_code_uq").on(table.organizationId, table.staffCode),
  uniqueIndex("staff_id_org_uq").on(table.id, table.organizationId),
  index("staff_org_status_idx").on(table.organizationId, table.status),
]);

export const externalIdentities = pgTable("external_identities", {
  id: id(),
  staffUserId: uuid("staff_user_id").notNull().references(() => staffUsers.id, { onDelete: "restrict" }),
  providerId: varchar("provider_id", { length: 80 }).notNull(),
  issuer: text("issuer").notNull(),
  subject: text("subject").notNull(),
  createdAt: createdAt(),
}, (table) => [
  uniqueIndex("external_identity_issuer_subject_uq").on(table.issuer, table.subject),
  uniqueIndex("external_identity_provider_subject_uq").on(table.providerId, table.subject),
]);

export const roles = pgTable("roles", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  key: varchar("key", { length: 80 }).notNull(),
  name: varchar("name", { length: 120 }).notNull(),
  scope: roleScope("scope").notNull(),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [uniqueIndex("roles_org_key_uq").on(table.organizationId, table.key), uniqueIndex("roles_id_org_uq").on(table.id, table.organizationId)]);

export const permissions = pgTable("permissions", {
  id: id(),
  key: varchar("key", { length: 100 }).notNull(),
  description: varchar("description", { length: 240 }).notNull(),
  scope: roleScope("scope").notNull(),
}, (table) => [uniqueIndex("permissions_key_uq").on(table.key)]);

export const rolePermissions = pgTable("role_permissions", {
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "cascade" }),
  permissionId: uuid("permission_id").notNull().references(() => permissions.id, { onDelete: "restrict" }),
  grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("role_permissions_pk").on(table.roleId, table.permissionId)]);

export const staffRoleAssignments = pgTable("staff_role_assignments", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  staffUserId: uuid("staff_user_id").notNull().references(() => staffUsers.id, { onDelete: "restrict" }),
  roleId: uuid("role_id").notNull().references(() => roles.id, { onDelete: "restrict" }),
  centreId: uuid("centre_id").references(() => centres.id, { onDelete: "restrict" }),
  assignedByStaffId: uuid("assigned_by_staff_id").references(() => staffUsers.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
}, (table) => [
  foreignKey({ columns: [table.staffUserId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_role_assignment_staff_org_fk" }),
  foreignKey({ columns: [table.roleId, table.organizationId], foreignColumns: [roles.id, roles.organizationId], name: "staff_role_assignment_role_org_fk" }),
  foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "staff_role_assignment_centre_org_fk" }),
  index("staff_role_assignments_staff_idx").on(table.staffUserId), index("staff_role_assignments_scope_idx").on(table.centreId),
]);

export const organizationSequences = pgTable("organization_sequences", {
  organizationId: uuid("organization_id").primaryKey().references(() => organizations.id, { onDelete: "restrict" }),
  nextStaffNumber: bigint("next_staff_number", { mode: "number" }).notNull().default(1),
  updatedAt: updatedAt(),
});

export const patients = pgTable("patients", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  centreId: uuid("centre_id").notNull().references(() => centres.id, { onDelete: "restrict" }),
  patientNumber: varchar("patient_number", { length: 24 }).notNull(),
  consentStatus: patientConsentStatus("consent_status").notNull(),
  consentRecordedAt: timestamp("consent_recorded_at", { withTimezone: true, mode: "date" }),
  consentMethod: varchar("consent_method", { length: 32 }),
  createdByStaffId: uuid("created_by_staff_id").notNull().references(() => staffUsers.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("patients_org_number_uq").on(table.organizationId, table.patientNumber),
  uniqueIndex("patients_id_org_uq").on(table.id, table.organizationId),
  uniqueIndex("patients_id_org_centre_uq").on(table.id, table.organizationId, table.centreId),
  foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "patients_centre_org_fk" }),
  foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "patients_creator_org_fk" }),
  index("patients_centre_created_idx").on(table.organizationId, table.centreId, table.createdAt),
]);

export const patientContactSecrets = pgTable("patient_contact_secrets", {
  patientId: uuid("patient_id").primaryKey(),
  organizationId: uuid("organization_id").notNull(),
  centreId: uuid("centre_id").notNull(),
  encryptionKeyId: varchar("encryption_key_id", { length: 48 }).notNull(),
  phoneCiphertext: text("phone_ciphertext").notNull(),
  emailCiphertext: text("email_ciphertext"),
  profileCiphertext: text("profile_ciphertext").notNull(),
  nameCiphertext: text("name_ciphertext").notNull(),
  phoneBlindIndex: varchar("phone_blind_index", { length: 64 }).notNull(),
  emailBlindIndex: varchar("email_blind_index", { length: 64 }),
  firstNameBlindIndex: varchar("first_name_blind_index", { length: 64 }).notNull(),
  lastNameBlindIndex: varchar("last_name_blind_index", { length: 64 }).notNull(),
  fullNameBlindIndex: varchar("full_name_blind_index", { length: 64 }).notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  foreignKey({ columns: [table.patientId, table.organizationId, table.centreId], foreignColumns: [patients.id, patients.organizationId, patients.centreId], name: "patient_contact_secrets_scope_fk" }),
  uniqueIndex("patient_contact_phone_blind_uq").on(table.organizationId, table.centreId, table.phoneBlindIndex),
  uniqueIndex("patient_contact_email_blind_uq").on(table.organizationId, table.centreId, table.emailBlindIndex).where(sql`${table.emailBlindIndex} IS NOT NULL`),
  index("patient_contact_scope_idx").on(table.organizationId, table.centreId, table.patientId),
  index("patient_name_first_blind_idx").on(table.organizationId, table.centreId, table.firstNameBlindIndex),
  index("patient_name_last_blind_idx").on(table.organizationId, table.centreId, table.lastNameBlindIndex),
  index("patient_name_full_blind_idx").on(table.organizationId, table.centreId, table.fullNameBlindIndex),
]);

export const patientRelationships = pgTable("patient_relationships", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  patientId: uuid("patient_id").notNull(),
  relatedPatientId: uuid("related_patient_id").notNull(),
  relationship: varchar("relationship", { length: 32 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("PENDING"),
  createdByStaffId: uuid("created_by_staff_id").notNull().references(() => staffUsers.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
}, (table) => [
  foreignKey({ columns: [table.patientId, table.organizationId], foreignColumns: [patients.id, patients.organizationId], name: "patient_relationship_source_org_fk" }),
  foreignKey({ columns: [table.relatedPatientId, table.organizationId], foreignColumns: [patients.id, patients.organizationId], name: "patient_relationship_target_org_fk" }),
  foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "patient_relationship_creator_org_fk" }),
  uniqueIndex("patient_relationship_active_uq").on(table.patientId, table.relatedPatientId, table.relationship),
  index("patient_relationship_source_idx").on(table.organizationId, table.patientId),
]);

export const families = pgTable("families", {
  id: id(),
  organizationId: uuid("organization_id").notNull().references(() => organizations.id, { onDelete: "restrict" }),
  centreId: uuid("centre_id").notNull(),
  familyNumber: varchar("family_number", { length: 24 }).notNull(),
  displayNameCiphertext: text("display_name_ciphertext"),
  displayNameBlindIndex: varchar("display_name_blind_index", { length: 64 }),
  primaryContactPatientId: uuid("primary_contact_patient_id"),
  createdByStaffId: uuid("created_by_staff_id").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("families_org_number_uq").on(table.organizationId, table.familyNumber),
  uniqueIndex("families_id_org_centre_uq").on(table.id, table.organizationId, table.centreId),
  foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "families_centre_org_fk" }),
  foreignKey({ columns: [table.primaryContactPatientId, table.organizationId, table.centreId], foreignColumns: [patients.id, patients.organizationId, patients.centreId], name: "families_primary_contact_patient_fk" }),
  foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "families_creator_org_fk" }),
  index("families_centre_created_idx").on(table.organizationId, table.centreId, table.createdAt),
  index("families_display_name_blind_idx").on(table.organizationId, table.centreId, table.displayNameBlindIndex),
]);

export const familyMembers = pgTable("family_members", {
  id: id(),
  organizationId: uuid("organization_id").notNull(),
  centreId: uuid("centre_id").notNull(),
  familyId: uuid("family_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  relationship: varchar("relationship", { length: 32 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("PENDING_VERIFICATION"),
  authorizationBasis: varchar("authorization_basis", { length: 32 }),
  evidenceCiphertext: text("evidence_ciphertext"),
  verifiedByStaffId: uuid("verified_by_staff_id"),
  verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
  createdByStaffId: uuid("created_by_staff_id").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  endedByStaffId: uuid("ended_by_staff_id"),
  endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
}, (table) => [
  foreignKey({ columns: [table.familyId, table.organizationId, table.centreId], foreignColumns: [families.id, families.organizationId, families.centreId], name: "family_members_family_scope_fk" }),
  foreignKey({ columns: [table.patientId, table.organizationId, table.centreId], foreignColumns: [patients.id, patients.organizationId, patients.centreId], name: "family_members_patient_scope_fk" }),
  foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "family_members_creator_org_fk" }),
  foreignKey({ columns: [table.verifiedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "family_members_verifier_org_fk" }),
  foreignKey({ columns: [table.endedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "family_members_ender_org_fk" }),
  uniqueIndex("family_members_active_patient_uq").on(table.familyId, table.patientId).where(sql`status IN ('PENDING_VERIFICATION', 'ACTIVE')`),
  index("family_members_family_idx").on(table.organizationId, table.familyId, table.status),
  index("family_members_patient_idx").on(table.organizationId, table.patientId, table.status),
]);

export const familyAccessGrants = pgTable("family_access_grants", {
  id: id(),
  organizationId: uuid("organization_id").notNull(),
  centreId: uuid("centre_id").notNull(),
  familyId: uuid("family_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  granteePatientId: uuid("grantee_patient_id").notNull(),
  allowedData: jsonb("allowed_data").$type<string[]>().notNull(),
  purposeCiphertext: text("purpose_ciphertext"),
  authorizationBasis: varchar("authorization_basis", { length: 32 }).notNull(),
  status: varchar("status", { length: 24 }).notNull().default("PENDING_VERIFICATION"),
  effectiveAt: timestamp("effective_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }),
  evidenceCiphertext: text("evidence_ciphertext"),
  createdByStaffId: uuid("created_by_staff_id").notNull(),
  createdAt: createdAt(),
  verifiedByStaffId: uuid("verified_by_staff_id"),
  verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
  revokedByStaffId: uuid("revoked_by_staff_id"),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
}, (table) => [
  foreignKey({ columns: [table.familyId, table.organizationId, table.centreId], foreignColumns: [families.id, families.organizationId, families.centreId], name: "family_access_grants_family_scope_fk" }),
  foreignKey({ columns: [table.patientId, table.organizationId, table.centreId], foreignColumns: [patients.id, patients.organizationId, patients.centreId], name: "family_access_grants_patient_scope_fk" }),
  foreignKey({ columns: [table.granteePatientId, table.organizationId, table.centreId], foreignColumns: [patients.id, patients.organizationId, patients.centreId], name: "family_access_grants_grantee_scope_fk" }),
  foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "family_access_grants_creator_org_fk" }),
  foreignKey({ columns: [table.verifiedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "family_access_grants_verifier_org_fk" }),
  foreignKey({ columns: [table.revokedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "family_access_grants_revoker_org_fk" }),
  index("family_access_grants_family_status_idx").on(table.organizationId, table.familyId, table.status),
  index("family_access_grants_patient_idx").on(table.organizationId, table.patientId, table.granteePatientId),
]);

export const familyContactArrangements = pgTable("family_contact_arrangements", {
  id: id(),
  organizationId: uuid("organization_id").notNull(),
  centreId: uuid("centre_id").notNull(),
  familyId: uuid("family_id").notNull(),
  patientId: uuid("patient_id").notNull(),
  channel: varchar("channel", { length: 12 }).notNull(),
  purpose: varchar("purpose", { length: 32 }).notNull(),
  status: varchar("status", { length: 16 }).notNull().default("PENDING"),
  authorizationBasis: varchar("authorization_basis", { length: 32 }),
  evidenceCiphertext: text("evidence_ciphertext"),
  createdByStaffId: uuid("created_by_staff_id").notNull(),
  createdAt: createdAt(),
  verifiedByStaffId: uuid("verified_by_staff_id"),
  verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
  revokedByStaffId: uuid("revoked_by_staff_id"),
  revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
}, (table) => [
  foreignKey({ columns: [table.familyId, table.organizationId, table.centreId], foreignColumns: [families.id, families.organizationId, families.centreId], name: "family_contact_arrangements_scope_fk" }),
  foreignKey({ columns: [table.patientId, table.organizationId, table.centreId], foreignColumns: [patients.id, patients.organizationId, patients.centreId], name: "family_contact_arrangements_member_scope_fk" }),
  foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "family_contact_arrangements_creator_fk" }),
  foreignKey({ columns: [table.verifiedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "family_contact_arrangements_verifier_fk" }),
  foreignKey({ columns: [table.revokedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "family_contact_arrangements_revoker_fk" }),
  uniqueIndex("family_contact_arrangements_active_uq").on(table.familyId, table.patientId, table.channel, table.purpose).where(sql`status IN ('PENDING', 'VERIFIED')`),
  index("family_contact_arrangements_family_idx").on(table.organizationId, table.familyId, table.status),
]);

export const marketingCampaigns = pgTable("marketing_campaigns", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), campaignCode: varchar("campaign_code", { length: 32 }).notNull(),
  channel: varchar("channel", { length: 20 }).notNull(), status: varchar("status", { length: 16 }).notNull().default("DRAFT"), startsOn: date("starts_on", { mode: "string" }), endsOn: date("ends_on", { mode: "string" }),
  privateDataCiphertext: text("private_data_ciphertext").notNull(), createdByStaffId: uuid("created_by_staff_id").notNull(), updatedByStaffId: uuid("updated_by_staff_id").notNull(), idempotencyKey: uuid("idempotency_key").notNull(), requestHash: varchar("request_hash", { length: 64 }).notNull(), versionNumber: integer("version_number").notNull().default(1), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("marketing_campaign_code_uq").on(table.organizationId, table.centreId, table.campaignCode), uniqueIndex("marketing_campaign_id_scope_uq").on(table.id, table.organizationId, table.centreId), uniqueIndex("marketing_campaign_idempotency_uq").on(table.organizationId, table.idempotencyKey),
  foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "marketing_campaign_centre_fk" }),
  foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "marketing_campaign_creator_fk" }),
  foreignKey({ columns: [table.updatedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "marketing_campaign_updater_fk" }),
  index("marketing_campaign_queue_idx").on(table.organizationId, table.centreId, table.status, table.updatedAt),
]);

export const marketingCampaignEvents = pgTable("marketing_campaign_events", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), campaignId: uuid("campaign_id").notNull(), actorStaffId: uuid("actor_staff_id").notNull(), eventType: varchar("event_type", { length: 16 }).notNull(), privateDataCiphertext: text("private_data_ciphertext").notNull(), idempotencyKey: uuid("idempotency_key").notNull(), requestHash: varchar("request_hash", { length: 64 }).notNull(), recordedAt: recordedAt(),
}, (table) => [foreignKey({ columns: [table.campaignId, table.organizationId, table.centreId], foreignColumns: [marketingCampaigns.id, marketingCampaigns.organizationId, marketingCampaigns.centreId], name: "marketing_campaign_event_campaign_fk" }), foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "marketing_campaign_event_actor_fk" }), uniqueIndex("marketing_campaign_event_idempotency_uq").on(table.organizationId, table.idempotencyKey), index("marketing_campaign_event_history_idx").on(table.organizationId, table.campaignId, table.recordedAt)]);

export const marketingContentItems = pgTable("marketing_content_items", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), campaignId: uuid("campaign_id"),
  channel: varchar("channel", { length: 16 }).notNull(), contentType: varchar("content_type", { length: 16 }).notNull(), status: varchar("status", { length: 16 }).notNull().default("DRAFT"), plannedPublishAt: timestamp("planned_publish_at", { withTimezone: true, mode: "date" }),
  privateDataCiphertext: text("private_data_ciphertext").notNull(), createdByStaffId: uuid("created_by_staff_id").notNull(), updatedByStaffId: uuid("updated_by_staff_id").notNull(), reviewedByStaffId: uuid("reviewed_by_staff_id"), versionNumber: integer("version_number").notNull().default(1), idempotencyKey: uuid("idempotency_key").notNull(), requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("marketing_content_id_scope_uq").on(table.id, table.organizationId, table.centreId), uniqueIndex("marketing_content_idempotency_uq").on(table.organizationId, table.idempotencyKey), foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "marketing_content_centre_fk" }), foreignKey({ columns: [table.campaignId, table.organizationId, table.centreId], foreignColumns: [marketingCampaigns.id, marketingCampaigns.organizationId, marketingCampaigns.centreId], name: "marketing_content_campaign_fk" }), foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "marketing_content_creator_fk" }), foreignKey({ columns: [table.updatedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "marketing_content_updater_fk" }), foreignKey({ columns: [table.reviewedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "marketing_content_reviewer_fk" }), index("marketing_content_calendar_idx").on(table.organizationId, table.centreId, table.status, table.plannedPublishAt, table.updatedAt)]);

export const marketingContentEvents = pgTable("marketing_content_events", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), contentItemId: uuid("content_item_id").notNull(), actorStaffId: uuid("actor_staff_id").notNull(), eventType: varchar("event_type", { length: 20 }).notNull(), privateDataCiphertext: text("private_data_ciphertext").notNull(), idempotencyKey: uuid("idempotency_key").notNull(), requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(), recordedAt: recordedAt(),
}, (table) => [foreignKey({ columns: [table.contentItemId, table.organizationId, table.centreId], foreignColumns: [marketingContentItems.id, marketingContentItems.organizationId, marketingContentItems.centreId], name: "marketing_content_event_item_fk" }), foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "marketing_content_event_actor_fk" }), uniqueIndex("marketing_content_event_idempotency_uq").on(table.organizationId, table.idempotencyKey), index("marketing_content_event_history_idx").on(table.organizationId, table.contentItemId, table.recordedAt)]);

export const leads = pgTable("leads", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(),
  leadNumber: varchar("lead_number", { length: 24 }).notNull(), enquiryCategory: varchar("enquiry_category", { length: 24 }).notNull(),
  homeCollectionInterest: boolean("home_collection_interest").notNull().default(false),
  source: varchar("source", { length: 24 }).notNull(), sourceRelationshipId: uuid("source_relationship_id"), sourceRelationshipType: varchar("source_relationship_type", { length: 16 }), sourceDoctorId: uuid("source_doctor_id"), marketingCampaignId: uuid("marketing_campaign_id"), status: varchar("status", { length: 24 }).notNull().default("NEW"),
  priority: varchar("priority", { length: 12 }).notNull().default("NORMAL"), assignedStaffId: uuid("assigned_staff_id").notNull(), preferredChannel: varchar("preferred_channel", { length: 12 }).notNull().default("PHONE"),
  contactPermission: varchar("contact_permission", { length: 24 }).notNull().default("PENDING"),
  contactPermissionRecordedBy: uuid("contact_permission_recorded_by"), contactPermissionRecordedAt: timestamp("contact_permission_recorded_at", { withTimezone: true, mode: "date" }),
  marketingConsent: varchar("marketing_consent", { length: 20 }).notNull().default("NOT_REQUESTED"),
  marketingConsentRecordedBy: uuid("marketing_consent_recorded_by"), marketingConsentRecordedAt: timestamp("marketing_consent_recorded_at", { withTimezone: true, mode: "date" }),
  duplicateOfLeadId: uuid("duplicate_of_lead_id"), convertedAt: timestamp("converted_at", { withTimezone: true, mode: "date" }),
  createdByStaffId: uuid("created_by_staff_id").notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("leads_org_number_uq").on(table.organizationId, table.leadNumber), uniqueIndex("leads_id_org_uq").on(table.id, table.organizationId), uniqueIndex("leads_id_org_centre_uq").on(table.id, table.organizationId, table.centreId),
  foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "leads_centre_org_fk" }),
  foreignKey({ columns: [table.assignedStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "leads_assignee_org_fk" }),
  foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "leads_creator_org_fk" }),
  foreignKey({ columns: [table.contactPermissionRecordedBy, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "leads_contact_recorder_org_fk" }),
  foreignKey({ columns: [table.marketingConsentRecordedBy, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "leads_marketing_recorder_org_fk" }),
  foreignKey({ columns: [table.duplicateOfLeadId, table.organizationId], foreignColumns: [table.id, table.organizationId], name: "leads_duplicate_org_fk" }),
  foreignKey({ columns: [table.marketingCampaignId, table.organizationId, table.centreId], foreignColumns: [marketingCampaigns.id, marketingCampaigns.organizationId, marketingCampaigns.centreId], name: "leads_marketing_campaign_scope_fk" }),
  index("leads_centre_created_idx").on(table.organizationId, table.centreId, table.createdAt), index("leads_centre_status_idx").on(table.organizationId, table.centreId, table.status, table.updatedAt), index("leads_assignee_status_idx").on(table.organizationId, table.assignedStaffId, table.status, table.updatedAt),
]);

export const leadPrivateData = pgTable("lead_private_data", {
  leadId: uuid("lead_id").primaryKey(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(),
  payloadCiphertext: text("payload_ciphertext").notNull(), phoneBlindIndex: varchar("phone_blind_index", { length: 64 }), emailBlindIndex: varchar("email_blind_index", { length: 64 }),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  foreignKey({ columns: [table.leadId, table.organizationId, table.centreId], foreignColumns: [leads.id, leads.organizationId, leads.centreId], name: "lead_private_data_scope_fk" }),
  index("lead_private_phone_blind_lookup_idx").on(table.organizationId, table.centreId, table.phoneBlindIndex),
  index("lead_private_email_blind_lookup_idx").on(table.organizationId, table.centreId, table.emailBlindIndex),
]);

export const publicEnquiries = pgTable("public_enquiries", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(),
  enquiryNumber: varchar("enquiry_number", { length: 28 }).notNull(), status: varchar("status", { length: 32 }).notNull().default("PENDING_REVIEW"),
  privateDataCiphertext: text("private_data_ciphertext").notNull(), phoneBlindIndex: varchar("phone_blind_index", { length: 64 }), emailBlindIndex: varchar("email_blind_index", { length: 64 }),
  idempotencyKey: uuid("idempotency_key").notNull(), requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(), versionNumber: integer("version_number").notNull().default(1),
  reviewedByStaffId: uuid("reviewed_by_staff_id"), reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }), resultingLeadId: uuid("resulting_lead_id"), createdAt: createdAt(),
}, (table) => [
  uniqueIndex("public_enquiries_id_org_centre_uq").on(table.id, table.organizationId, table.centreId),
  uniqueIndex("public_enquiries_org_number_uq").on(table.organizationId, table.enquiryNumber),
  uniqueIndex("public_enquiries_idempotency_uq").on(table.organizationId, table.idempotencyKey),
  foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "public_enquiries_centre_org_fk" }),
  foreignKey({ columns: [table.reviewedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "public_enquiries_reviewer_fk" }),
  foreignKey({ columns: [table.resultingLeadId, table.organizationId, table.centreId], foreignColumns: [leads.id, leads.organizationId, leads.centreId], name: "public_enquiries_lead_fk" }),
  index("public_enquiries_review_queue_idx").on(table.organizationId, table.centreId, table.status, table.createdAt),
  index("public_enquiries_phone_lookup_idx").on(table.organizationId, table.centreId, table.phoneBlindIndex),
  index("public_enquiries_email_lookup_idx").on(table.organizationId, table.centreId, table.emailBlindIndex),
]);

export const publicEnquiryEvents = pgTable("public_enquiry_events", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), enquiryId: uuid("enquiry_id").notNull(),
  eventType: varchar("event_type", { length: 32 }).notNull(), privateDataCiphertext: text("private_data_ciphertext").notNull(),
  actorStaffId: uuid("actor_staff_id"), recordedAt: recordedAt(),
}, (table) => [
  foreignKey({ columns: [table.enquiryId, table.organizationId, table.centreId], foreignColumns: [publicEnquiries.id, publicEnquiries.organizationId, publicEnquiries.centreId], name: "public_enquiry_events_enquiry_fk" }),
  foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "public_enquiry_events_actor_fk" }),
  index("public_enquiry_events_history_idx").on(table.organizationId, table.enquiryId, table.recordedAt),
]);

export const leadActivities = pgTable("lead_activities", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), leadId: uuid("lead_id").notNull(), actorStaffId: uuid("actor_staff_id").notNull(),
  activityType: varchar("activity_type", { length: 24 }).notNull(), privatePayloadCiphertext: text("private_payload_ciphertext").notNull(), recordedAt: recordedAt(),
}, (table) => [
  foreignKey({ columns: [table.leadId, table.organizationId, table.centreId], foreignColumns: [leads.id, leads.organizationId, leads.centreId], name: "lead_activities_lead_scope_fk" }),
  foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "lead_activities_actor_org_fk" }),
  index("lead_activities_timeline_idx").on(table.organizationId, table.leadId, table.recordedAt),
]);

// Internal, immutable price previews for a CRM lead. These are not sent to
// customers and cannot be treated as accepted orders or invoices.
export const leadQuotes = pgTable("lead_quotes", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), leadId: uuid("lead_id").notNull(),
  quoteNumber: varchar("quote_number", { length: 48 }).notNull(), versionNumber: integer("version_number").notNull(), status: varchar("status", { length: 24 }).notNull().default("INTERNAL_DRAFT"),
  privateSnapshotCiphertext: text("private_snapshot_ciphertext").notNull(), createdByStaffId: uuid("created_by_staff_id").notNull(), idempotencyKey: uuid("idempotency_key").notNull(), requestFingerprint: varchar("request_fingerprint", { length: 64 }).notNull(), createdAt: createdAt(),
}, (table) => [
  uniqueIndex("lead_quotes_org_number_uq").on(table.organizationId, table.quoteNumber), uniqueIndex("lead_quotes_org_idempotency_uq").on(table.organizationId, table.idempotencyKey), uniqueIndex("lead_quotes_lead_version_uq").on(table.organizationId, table.leadId, table.versionNumber), uniqueIndex("lead_quotes_id_scope_uq").on(table.id, table.organizationId, table.centreId),
  foreignKey({ columns: [table.leadId, table.organizationId, table.centreId], foreignColumns: [leads.id, leads.organizationId, leads.centreId], name: "lead_quotes_lead_scope_fk" }),
  foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "lead_quotes_creator_org_fk" }),
  index("lead_quotes_lead_created_idx").on(table.organizationId, table.centreId, table.leadId, table.createdAt),
]);

export const leadFollowups = pgTable("lead_followups", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), leadId: uuid("lead_id").notNull(), assignedStaffId: uuid("assigned_staff_id").notNull(),
  dueAt: timestamp("due_at", { withTimezone: true, mode: "date" }).notNull(), taskType: varchar("task_type", { length: 20 }).notNull().default("ADMINISTRATIVE"), status: varchar("status", { length: 16 }).notNull().default("SCHEDULED"), outcome: varchar("outcome", { length: 32 }), outcomeNoteCiphertext: text("outcome_note_ciphertext"),
  createdByStaffId: uuid("created_by_staff_id").notNull(), createdAt: createdAt(), updatedAt: updatedAt(), completedByStaffId: uuid("completed_by_staff_id"), completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
}, (table) => [
  foreignKey({ columns: [table.leadId, table.organizationId, table.centreId], foreignColumns: [leads.id, leads.organizationId, leads.centreId], name: "lead_followups_lead_scope_fk" }),
  foreignKey({ columns: [table.assignedStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "lead_followups_assignee_org_fk" }),
  foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "lead_followups_creator_org_fk" }),
  foreignKey({ columns: [table.completedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "lead_followups_completer_org_fk" }),
  index("lead_followups_due_idx").on(table.organizationId, table.centreId, table.status, table.dueAt), index("lead_followups_assignee_due_idx").on(table.organizationId, table.assignedStaffId, table.status, table.dueAt),
]);

export const leadCommunicationDrafts = pgTable("lead_communication_drafts", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), leadId: uuid("lead_id").notNull(), createdByStaffId: uuid("created_by_staff_id").notNull(),
  purpose: varchar("purpose", { length: 16 }).notNull(), channel: varchar("channel", { length: 16 }).notNull(), status: varchar("status", { length: 16 }).notNull().default("DRAFT"), bodyCiphertext: text("body_ciphertext").notNull(), templateId: uuid("template_id"), templateVersion: integer("template_version"), idempotencyKey: uuid("idempotency_key").notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("lead_communication_drafts_org_idempotency_uq").on(table.organizationId, table.idempotencyKey),
  uniqueIndex("lead_communication_drafts_id_scope_uq").on(table.id, table.organizationId, table.centreId),
  foreignKey({ columns: [table.leadId, table.organizationId, table.centreId], foreignColumns: [leads.id, leads.organizationId, leads.centreId], name: "lead_communication_drafts_scope_fk" }),
  foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "lead_communication_drafts_actor_fk" }),
  index("lead_communication_drafts_queue_idx").on(table.organizationId, table.centreId, table.status, table.createdAt),
  index("lead_communication_drafts_lead_idx").on(table.organizationId, table.leadId, table.createdAt),
]);

export const leadCommunicationDraftEvents = pgTable("lead_communication_draft_events", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), draftId: uuid("draft_id").notNull(), actorStaffId: uuid("actor_staff_id").notNull(), eventType: varchar("event_type", { length: 16 }).notNull(), recordedAt: recordedAt(),
}, (table) => [
  foreignKey({ columns: [table.draftId, table.organizationId, table.centreId], foreignColumns: [leadCommunicationDrafts.id, leadCommunicationDrafts.organizationId, leadCommunicationDrafts.centreId], name: "lead_communication_draft_events_draft_fk" }),
  foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "lead_communication_draft_events_actor_fk" }),
  index("lead_communication_draft_events_history_idx").on(table.organizationId, table.draftId, table.recordedAt),
]);

export const communicationTemplates = pgTable("communication_templates", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), createdByStaffId: uuid("created_by_staff_id").notNull(), updatedByStaffId: uuid("updated_by_staff_id").notNull(),
  purpose: varchar("purpose", { length: 16 }).notNull(), channel: varchar("channel", { length: 16 }).notNull(), status: varchar("status", { length: 16 }).notNull().default("DRAFT"), versionNumber: integer("version_number").notNull().default(1), privateDataCiphertext: text("private_data_ciphertext").notNull(), idempotencyKey: uuid("idempotency_key").notNull(), requestHash: varchar("request_hash", { length: 64 }).notNull(),
  createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("communication_templates_org_idempotency_uq").on(table.organizationId, table.idempotencyKey),
  uniqueIndex("communication_templates_id_scope_uq").on(table.id, table.organizationId, table.centreId),
  foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "communication_templates_creator_fk" }),
  foreignKey({ columns: [table.updatedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "communication_templates_updater_fk" }),
  index("communication_templates_queue_idx").on(table.organizationId, table.centreId, table.status, table.updatedAt),
]);

export const communicationTemplateEvents = pgTable("communication_template_events", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), templateId: uuid("template_id").notNull(), actorStaffId: uuid("actor_staff_id").notNull(), eventType: varchar("event_type", { length: 16 }).notNull(), privateDataCiphertext: text("private_data_ciphertext").notNull(), idempotencyKey: uuid("idempotency_key").notNull(), requestHash: varchar("request_hash", { length: 64 }).notNull(), recordedAt: recordedAt(),
}, (table) => [
  foreignKey({ columns: [table.templateId, table.organizationId, table.centreId], foreignColumns: [communicationTemplates.id, communicationTemplates.organizationId, communicationTemplates.centreId], name: "communication_template_events_template_fk" }),
  foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "communication_template_events_actor_fk" }),
  uniqueIndex("communication_template_events_org_idempotency_uq").on(table.organizationId, table.idempotencyKey),
  index("communication_template_events_history_idx").on(table.organizationId, table.templateId, table.recordedAt),
]);

export const leadConversions = pgTable("lead_conversions", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), leadId: uuid("lead_id").notNull(), patientId: uuid("patient_id").notNull(), conversionMode: varchar("conversion_mode", { length: 12 }).notNull(),
  identityEvidenceCiphertext: text("identity_evidence_ciphertext"), convertedByStaffId: uuid("converted_by_staff_id").notNull(), convertedAt: timestamp("converted_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("lead_conversions_lead_uq").on(table.leadId),
  foreignKey({ columns: [table.leadId, table.organizationId, table.centreId], foreignColumns: [leads.id, leads.organizationId, leads.centreId], name: "lead_conversions_lead_scope_fk" }),
  foreignKey({ columns: [table.patientId, table.organizationId, table.centreId], foreignColumns: [patients.id, patients.organizationId, patients.centreId], name: "lead_conversions_patient_scope_fk" }),
  foreignKey({ columns: [table.convertedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "lead_conversions_actor_org_fk" }),
  index("lead_conversions_patient_idx").on(table.organizationId, table.patientId),
]);

export const appointments = pgTable("appointments", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), appointmentNumber: varchar("appointment_number", { length: 24 }).notNull(),
  patientId: uuid("patient_id").notNull(), leadId: uuid("lead_id"), bookingSource: varchar("booking_source", { length: 24 }).notNull(), visitType: varchar("visit_type", { length: 24 }).notNull(),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true, mode: "date" }).notNull(), durationMinutes: integer("duration_minutes").notNull().default(30), timeZone: varchar("time_zone", { length: 64 }).notNull(),
  status: varchar("status", { length: 20 }).notNull().default("REQUESTED"), assignedStaffId: uuid("assigned_staff_id"), homeCollectionWindow: varchar("home_collection_window", { length: 120 }), privateDataCiphertext: text("private_data_ciphertext").notNull(),
  communicationPermission: varchar("communication_permission", { length: 16 }).notNull().default("PENDING"), communicationPermissionRecordedBy: uuid("communication_permission_recorded_by"), communicationPermissionRecordedAt: timestamp("communication_permission_recorded_at", { withTimezone: true, mode: "date" }),
  homeChargeChoice: varchar("home_charge_choice", { length: 16 }), homeChargeRupees: integer("home_charge_rupees"), createdByStaffId: uuid("created_by_staff_id").notNull(), idempotencyKey: uuid("idempotency_key").notNull(), requestHash: varchar("request_hash", { length: 64 }).notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [
  uniqueIndex("appointments_org_number_uq").on(table.organizationId, table.appointmentNumber), uniqueIndex("appointments_id_org_centre_uq").on(table.id, table.organizationId, table.centreId), uniqueIndex("appointments_idempotency_uq").on(table.organizationId, table.idempotencyKey),
  foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "appointments_centre_org_fk" }), foreignKey({ columns: [table.patientId, table.organizationId, table.centreId], foreignColumns: [patients.id, patients.organizationId, patients.centreId], name: "appointments_patient_scope_fk" }), foreignKey({ columns: [table.leadId, table.organizationId, table.centreId], foreignColumns: [leads.id, leads.organizationId, leads.centreId], name: "appointments_lead_scope_fk" }),
  foreignKey({ columns: [table.assignedStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "appointments_assignee_org_fk" }), foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "appointments_creator_org_fk" }), foreignKey({ columns: [table.communicationPermissionRecordedBy, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "appointments_communication_recorder_fk" }),
  index("appointments_centre_time_idx").on(table.organizationId, table.centreId, table.scheduledAt), index("appointments_centre_status_time_idx").on(table.organizationId, table.centreId, table.status, table.scheduledAt), index("appointments_assignee_time_idx").on(table.organizationId, table.assignedStaffId, table.status, table.scheduledAt), index("appointments_patient_time_idx").on(table.organizationId, table.patientId, table.scheduledAt),
]);

export const appointmentServices = pgTable("appointment_services", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), appointmentId: uuid("appointment_id").notNull(), serviceType: varchar("service_type", { length: 12 }).notNull(), privateDataCiphertext: text("private_data_ciphertext").notNull(), verificationStatus: varchar("verification_status", { length: 16 }).notNull().default("PENDING"), recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [foreignKey({ columns: [table.appointmentId, table.organizationId, table.centreId], foreignColumns: [appointments.id, appointments.organizationId, appointments.centreId], name: "appointment_services_appointment_scope_fk" }), index("appointment_services_appt_idx").on(table.organizationId, table.appointmentId)]);

export const appointmentStatusHistory = pgTable("appointment_status_history", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), appointmentId: uuid("appointment_id").notNull(), fromStatus: varchar("from_status", { length: 20 }), toStatus: varchar("to_status", { length: 20 }).notNull(), privateDataCiphertext: text("private_data_ciphertext").notNull(), previousScheduledAt: timestamp("previous_scheduled_at", { withTimezone: true, mode: "date" }), newScheduledAt: timestamp("new_scheduled_at", { withTimezone: true, mode: "date" }).notNull(), actorStaffId: uuid("actor_staff_id").notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [foreignKey({ columns: [table.appointmentId, table.organizationId, table.centreId], foreignColumns: [appointments.id, appointments.organizationId, appointments.centreId], name: "appointment_status_history_scope_fk" }), foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "appointment_status_history_actor_fk" }), index("appointment_status_history_appt_idx").on(table.organizationId, table.appointmentId, table.recordedAt)]);

export const appointmentAssignmentHistory = pgTable("appointment_assignment_history", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), appointmentId: uuid("appointment_id").notNull(), action: varchar("action", { length: 16 }).notNull(), staffId: uuid("staff_id"), previousStaffId: uuid("previous_staff_id"), workStart: timestamp("work_start", { withTimezone: true, mode: "date" }).notNull(), workEnd: timestamp("work_end", { withTimezone: true, mode: "date" }).notNull(), privateDataCiphertext: text("private_data_ciphertext").notNull(), actorStaffId: uuid("actor_staff_id").notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [foreignKey({ columns: [table.appointmentId, table.organizationId, table.centreId], foreignColumns: [appointments.id, appointments.organizationId, appointments.centreId], name: "appointment_assignment_scope_fk" }), foreignKey({ columns: [table.staffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "appointment_assignment_staff_fk" }), foreignKey({ columns: [table.previousStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "appointment_assignment_previous_staff_fk" }), foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "appointment_assignment_actor_fk" }), index("appointment_assignment_history_staff_idx").on(table.organizationId, table.staffId, table.workStart)]);

export const appointmentArrivalEvents = pgTable("appointment_arrival_events", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), appointmentId: uuid("appointment_id").notNull(),
  arrivalSource: varchar("arrival_source", { length: 20 }).notNull().default("FRONT_DESK"), actorStaffId: uuid("actor_staff_id").notNull(),
  idempotencyKey: uuid("idempotency_key").notNull(), requestHash: varchar("request_hash", { length: 64 }).notNull(), arrivedAt: timestamp("arrived_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("appointment_arrival_once_uq").on(table.organizationId, table.appointmentId),
  uniqueIndex("appointment_arrival_idempotency_uq").on(table.organizationId, table.idempotencyKey),
  foreignKey({ columns: [table.appointmentId, table.organizationId, table.centreId], foreignColumns: [appointments.id, appointments.organizationId, appointments.centreId], name: "appointment_arrival_scope_fk" }),
  foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "appointment_arrival_actor_fk" }),
  index("appointment_arrivals_centre_time_idx").on(table.organizationId, table.centreId, table.arrivedAt),
]);

export const appointmentQueueTokens = pgTable("appointment_queue_tokens", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), appointmentId: uuid("appointment_id").notNull(), queueDate: date("queue_date", { mode: "string" }).notNull(), tokenNumber: integer("token_number").notNull(), status: varchar("status", { length: 12 }).notNull().default("WAITING"), actorStaffId: uuid("actor_staff_id").notNull(), idempotencyKey: uuid("idempotency_key").notNull(), requestHash: varchar("request_hash", { length: 64 }).notNull(), versionNumber: integer("version_number").notNull().default(1), issuedAt: timestamp("issued_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(), calledAt: timestamp("called_at", { withTimezone: true, mode: "date" }),
}, (table) => [uniqueIndex("appointment_queue_scope_uq").on(table.id, table.organizationId, table.centreId), uniqueIndex("appointment_queue_token_number_uq").on(table.organizationId, table.centreId, table.queueDate, table.tokenNumber), uniqueIndex("appointment_queue_appointment_uq").on(table.organizationId, table.appointmentId), uniqueIndex("appointment_queue_idempotency_uq").on(table.organizationId, table.idempotencyKey), foreignKey({ columns: [table.appointmentId, table.organizationId, table.centreId], foreignColumns: [appointments.id, appointments.organizationId, appointments.centreId], name: "appointment_queue_scope_fk" }), foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "appointment_queue_actor_fk" }), index("appointment_queue_centre_day_idx").on(table.organizationId, table.centreId, table.queueDate, table.status, table.tokenNumber)]);

export const appointmentQueueEvents = pgTable("appointment_queue_events", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), queueTokenId: uuid("queue_token_id").notNull(), eventType: varchar("event_type", { length: 12 }).notNull(), actorStaffId: uuid("actor_staff_id").notNull(), idempotencyKey: uuid("idempotency_key").notNull(), requestHash: varchar("request_hash", { length: 64 }).notNull(), recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [foreignKey({ columns: [table.queueTokenId, table.organizationId, table.centreId], foreignColumns: [appointmentQueueTokens.id, appointmentQueueTokens.organizationId, appointmentQueueTokens.centreId], name: "appointment_queue_event_token_fk" }), foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "appointment_queue_event_actor_fk" }), uniqueIndex("appointment_queue_event_once_uq").on(table.queueTokenId, table.eventType), uniqueIndex("appointment_queue_event_idempotency_uq").on(table.organizationId, table.idempotencyKey), index("appointment_queue_event_history_idx").on(table.organizationId, table.queueTokenId, table.recordedAt)]);

export const catalogueImportBatches = pgTable("catalogue_import_batches", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), fileDigest: varchar("file_digest", { length: 64 }).notNull(), rowCount: integer("row_count").notNull(), createdCount: integer("created_count").notNull().default(0), rejectedCount: integer("rejected_count").notNull().default(0), sourceReference: varchar("source_reference", { length: 200 }).notNull(), importedByStaffId: uuid("imported_by_staff_id").notNull(), importedAt: timestamp("imported_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("catalogue_import_batches_scope_uq").on(table.id, table.organizationId, table.centreId), foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "catalogue_import_batches_centre_fk" }), foreignKey({ columns: [table.importedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "catalogue_import_batches_actor_fk" })]);

export const diagnosticCatalogueItems = pgTable("diagnostic_catalogue_items", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), serviceType: varchar("service_type", { length: 12 }).notNull(), serviceCode: varchar("service_code", { length: 80 }).notNull(), currentVersion: integer("current_version").notNull().default(1), active: boolean("active").notNull().default(true), publicVisible: boolean("public_visible").notNull().default(false), publicVisibilityUpdatedAt: timestamp("public_visibility_updated_at", { withTimezone: true, mode: "date" }), publicVisibilityUpdatedByStaffId: uuid("public_visibility_updated_by_staff_id"), createdByStaffId: uuid("created_by_staff_id").notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("diagnostic_catalogue_items_code_uq").on(table.organizationId, table.centreId, table.serviceType, table.serviceCode), uniqueIndex("diagnostic_catalogue_items_scope_uq").on(table.id, table.organizationId, table.centreId), foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "diagnostic_catalogue_items_centre_fk" }), foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "diagnostic_catalogue_items_actor_fk" }), foreignKey({ columns: [table.publicVisibilityUpdatedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "diagnostic_catalogue_items_public_actor_fk" }), index("diagnostic_catalogue_centre_type_idx").on(table.organizationId, table.centreId, table.serviceType, table.active, table.serviceCode), index("diagnostic_catalogue_public_idx").on(table.centreId, table.publicVisible, table.active)]);

export const diagnosticCatalogueVersions = pgTable("diagnostic_catalogue_versions", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), catalogueItemId: uuid("catalogue_item_id").notNull(), versionNumber: integer("version_number").notNull(), displayName: varchar("display_name", { length: 180 }).notNull(), specimenRequirements: varchar("specimen_requirements", { length: 500 }), preparationInstructions: varchar("preparation_instructions", { length: 1000 }), metropolisReferenceCode: varchar("metropolis_reference_code", { length: 100 }), verificationStatus: varchar("verification_status", { length: 16 }).notNull().default("UNVERIFIED"), priceAmount: numeric("price_amount", { precision: 12, scale: 2 }), currency: varchar("currency", { length: 3 }).notNull().default("INR"), priceSourceReference: varchar("price_source_reference", { length: 200 }), effectiveFrom: date("effective_from", { mode: "string" }), effectiveUntil: date("effective_until", { mode: "string" }), reviewedByStaffId: uuid("reviewed_by_staff_id"), reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }), importBatchId: uuid("import_batch_id"), sourceType: varchar("source_type", { length: 20 }).notNull(), createdByStaffId: uuid("created_by_staff_id").notNull(), createdAt: createdAt(),
}, (table) => [uniqueIndex("diagnostic_catalogue_versions_number_uq").on(table.catalogueItemId, table.versionNumber), uniqueIndex("diagnostic_catalogue_versions_scope_uq").on(table.id, table.organizationId, table.centreId), foreignKey({ columns: [table.catalogueItemId, table.organizationId, table.centreId], foreignColumns: [diagnosticCatalogueItems.id, diagnosticCatalogueItems.organizationId, diagnosticCatalogueItems.centreId], name: "diagnostic_catalogue_versions_item_fk" }), foreignKey({ columns: [table.importBatchId, table.organizationId, table.centreId], foreignColumns: [catalogueImportBatches.id, catalogueImportBatches.organizationId, catalogueImportBatches.centreId], name: "diagnostic_catalogue_versions_batch_fk" }), foreignKey({ columns: [table.reviewedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "diagnostic_catalogue_versions_reviewer_fk" }), foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "diagnostic_catalogue_versions_actor_fk" }), index("diagnostic_catalogue_version_current_idx").on(table.organizationId, table.centreId, table.catalogueItemId, table.versionNumber)]);

export const diagnosticPackageComponents = pgTable("diagnostic_package_components", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), packageVersionId: uuid("package_version_id").notNull(), testVersionId: uuid("test_version_id").notNull(), createdAt: createdAt(),
}, (table) => [uniqueIndex("diagnostic_package_components_uq").on(table.packageVersionId, table.testVersionId), foreignKey({ columns: [table.packageVersionId, table.organizationId, table.centreId], foreignColumns: [diagnosticCatalogueVersions.id, diagnosticCatalogueVersions.organizationId, diagnosticCatalogueVersions.centreId], name: "diagnostic_package_components_package_fk" }), foreignKey({ columns: [table.testVersionId, table.organizationId, table.centreId], foreignColumns: [diagnosticCatalogueVersions.id, diagnosticCatalogueVersions.organizationId, diagnosticCatalogueVersions.centreId], name: "diagnostic_package_components_test_fk" })]);

export const cataloguePriceReviews = pgTable("catalogue_price_reviews", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), catalogueVersionId: uuid("catalogue_version_id").notNull(), decision: varchar("decision", { length: 12 }).notNull(), sourceReference: varchar("source_reference", { length: 200 }).notNull(), effectiveFrom: date("effective_from", { mode: "string" }).notNull(), effectiveUntil: date("effective_until", { mode: "string" }), reviewedByStaffId: uuid("reviewed_by_staff_id").notNull(), reason: varchar("reason", { length: 240 }).notNull(), reviewedAt: timestamp("reviewed_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [foreignKey({ columns: [table.catalogueVersionId, table.organizationId, table.centreId], foreignColumns: [diagnosticCatalogueVersions.id, diagnosticCatalogueVersions.organizationId, diagnosticCatalogueVersions.centreId], name: "catalogue_price_reviews_version_fk" }), foreignKey({ columns: [table.reviewedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "catalogue_price_reviews_reviewer_fk" })]);

export const diagnosticOrders = pgTable("diagnostic_orders", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), orderNumber: varchar("order_number", { length: 30 }).notNull(), patientId: uuid("patient_id").notNull(), appointmentId: uuid("appointment_id"), status: varchar("status", { length: 24 }).notNull(), versionNumber: integer("version_number").notNull().default(1), idempotencyKey: uuid("idempotency_key").notNull(), requestHash: varchar("request_hash", { length: 64 }).notNull(), currency: varchar("currency", { length: 3 }).notNull().default("INR"), totalAmount: numeric("total_amount", { precision: 12, scale: 2 }), createdByStaffId: uuid("created_by_staff_id").notNull(), confirmedByStaffId: uuid("confirmed_by_staff_id"), confirmedAt: timestamp("confirmed_at", { withTimezone: true, mode: "date" }), cancellationReason: varchar("cancellation_reason", { length: 240 }), cancelledByStaffId: uuid("cancelled_by_staff_id"), cancelledAt: timestamp("cancelled_at", { withTimezone: true, mode: "date" }), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("diagnostic_orders_number_uq").on(table.organizationId, table.orderNumber), uniqueIndex("diagnostic_orders_idempotency_uq").on(table.organizationId, table.idempotencyKey), uniqueIndex("diagnostic_orders_scope_uq").on(table.id, table.organizationId, table.centreId), foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "diagnostic_orders_centre_fk" }), foreignKey({ columns: [table.patientId, table.organizationId, table.centreId], foreignColumns: [patients.id, patients.organizationId, patients.centreId], name: "diagnostic_orders_patient_fk" }), foreignKey({ columns: [table.appointmentId, table.organizationId, table.centreId], foreignColumns: [appointments.id, appointments.organizationId, appointments.centreId], name: "diagnostic_orders_appointment_fk" }), foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "diagnostic_orders_creator_fk" }), foreignKey({ columns: [table.confirmedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "diagnostic_orders_confirmer_fk" }), foreignKey({ columns: [table.cancelledByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "diagnostic_orders_canceller_fk" }), index("diagnostic_orders_centre_status_idx").on(table.organizationId, table.centreId, table.status, table.createdAt), index("diagnostic_orders_patient_idx").on(table.organizationId, table.patientId, table.createdAt)]);

export const diagnosticOrderItems = pgTable("diagnostic_order_items", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), orderId: uuid("order_id").notNull(), catalogueItemId: uuid("catalogue_item_id").notNull(), catalogueVersionId: uuid("catalogue_version_id").notNull(), serviceType: varchar("service_type", { length: 12 }).notNull(), serviceCode: varchar("service_code", { length: 80 }).notNull(), displayName: varchar("display_name", { length: 180 }).notNull(), verificationStatus: varchar("verification_status", { length: 16 }).notNull(), priceAmount: numeric("price_amount", { precision: 12, scale: 2 }), currency: varchar("currency", { length: 3 }).notNull().default("INR"), priceSourceReference: varchar("price_source_reference", { length: 200 }), effectiveFrom: date("effective_from", { mode: "string" }), effectiveUntil: date("effective_until", { mode: "string" }), serviceSnapshot: jsonb("service_snapshot").$type<Record<string, unknown>>().notNull(), removedAt: timestamp("removed_at", { withTimezone: true, mode: "date" }), removedByStaffId: uuid("removed_by_staff_id"), removalReason: varchar("removal_reason", { length: 240 }), createdAt: createdAt(),
}, (table) => [uniqueIndex("diagnostic_order_items_active_item_uq").on(table.orderId, table.catalogueItemId).where(sql`${table.removedAt} IS NULL`), foreignKey({ columns: [table.orderId, table.organizationId, table.centreId], foreignColumns: [diagnosticOrders.id, diagnosticOrders.organizationId, diagnosticOrders.centreId], name: "diagnostic_order_items_order_fk" }), foreignKey({ columns: [table.catalogueItemId, table.organizationId, table.centreId], foreignColumns: [diagnosticCatalogueItems.id, diagnosticCatalogueItems.organizationId, diagnosticCatalogueItems.centreId], name: "diagnostic_order_items_catalogue_item_fk" }), foreignKey({ columns: [table.catalogueVersionId, table.organizationId, table.centreId], foreignColumns: [diagnosticCatalogueVersions.id, diagnosticCatalogueVersions.organizationId, diagnosticCatalogueVersions.centreId], name: "diagnostic_order_items_catalogue_version_fk" }), foreignKey({ columns: [table.removedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "diagnostic_order_items_remover_fk" }), index("diagnostic_order_items_order_idx").on(table.organizationId, table.orderId)]);

export const diagnosticOrderStatusHistory = pgTable("diagnostic_order_status_history", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), orderId: uuid("order_id").notNull(), fromStatus: varchar("from_status", { length: 24 }), toStatus: varchar("to_status", { length: 24 }).notNull(), reason: varchar("reason", { length: 240 }).notNull(), versionNumber: integer("version_number").notNull(), actorStaffId: uuid("actor_staff_id").notNull(), recordedAt: recordedAt(),
}, (table) => [foreignKey({ columns: [table.orderId, table.organizationId, table.centreId], foreignColumns: [diagnosticOrders.id, diagnosticOrders.organizationId, diagnosticOrders.centreId], name: "diagnostic_order_status_history_order_fk" }), foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "diagnostic_order_status_history_actor_fk" }), index("diagnostic_order_history_idx").on(table.organizationId, table.orderId, table.recordedAt)]);

export const collectionJobs = pgTable("collection_jobs", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), jobNumber: varchar("job_number", { length: 32 }).notNull(),
  appointmentId: uuid("appointment_id").notNull(), orderId: uuid("order_id").notNull(), patientId: uuid("patient_id").notNull(), status: varchar("status", { length: 24 }).notNull(),
  assignedStaffId: uuid("assigned_staff_id"), scheduledStart: timestamp("scheduled_start", { withTimezone: true, mode: "date" }).notNull(), scheduledEnd: timestamp("scheduled_end", { withTimezone: true, mode: "date" }).notNull(),
  versionNumber: integer("version_number").notNull().default(1), idempotencyKey: uuid("idempotency_key").notNull(), createdByStaffId: uuid("created_by_staff_id").notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("collection_jobs_org_number_uq").on(table.organizationId, table.jobNumber), uniqueIndex("collection_jobs_org_order_uq").on(table.organizationId, table.orderId), uniqueIndex("collection_jobs_idempotency_uq").on(table.organizationId, table.idempotencyKey), uniqueIndex("collection_jobs_scope_uq").on(table.id, table.organizationId, table.centreId), foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "collection_jobs_centre_fk" }), foreignKey({ columns: [table.appointmentId, table.organizationId, table.centreId], foreignColumns: [appointments.id, appointments.organizationId, appointments.centreId], name: "collection_jobs_appointment_fk" }), foreignKey({ columns: [table.orderId, table.organizationId, table.centreId], foreignColumns: [diagnosticOrders.id, diagnosticOrders.organizationId, diagnosticOrders.centreId], name: "collection_jobs_order_fk" }), foreignKey({ columns: [table.patientId, table.organizationId, table.centreId], foreignColumns: [patients.id, patients.organizationId, patients.centreId], name: "collection_jobs_patient_fk" }), foreignKey({ columns: [table.assignedStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "collection_jobs_assignee_fk" }), foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "collection_jobs_creator_fk" }), index("collection_jobs_schedule_idx").on(table.organizationId, table.centreId, table.scheduledStart, table.status), index("collection_jobs_staff_idx").on(table.organizationId, table.assignedStaffId, table.scheduledStart, table.status)]);

export const collectionJobEvents = pgTable("collection_job_events", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), jobId: uuid("job_id").notNull(), eventType: varchar("event_type", { length: 32 }).notNull(), source: varchar("source", { length: 24 }).notNull(),privateDataCiphertext: text("private_data_ciphertext").notNull(), staffId: uuid("staff_id"), previousStaffId: uuid("previous_staff_id"), actorStaffId: uuid("actor_staff_id").notNull(), recordedAt: recordedAt(),
}, (table) => [foreignKey({ columns: [table.jobId, table.organizationId, table.centreId], foreignColumns: [collectionJobs.id, collectionJobs.organizationId, collectionJobs.centreId], name: "collection_job_events_job_fk" }), foreignKey({ columns: [table.staffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "collection_job_events_staff_fk" }), foreignKey({ columns: [table.previousStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "collection_job_events_previous_staff_fk" }), foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "collection_job_events_actor_fk" }), index("collection_job_events_idx").on(table.organizationId, table.jobId, table.recordedAt)]);

export const sampleProcedureApprovals = pgTable("sample_procedure_approvals", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), operation: varchar("operation", { length: 20 }).notNull(), reference: varchar("reference", { length: 200 }).notNull(), status: varchar("status", { length: 16 }).notNull(), approvedByStaffId: uuid("approved_by_staff_id").notNull(), approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(), revokedByStaffId: uuid("revoked_by_staff_id"), revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
}, (table) => [uniqueIndex("sample_procedure_scope_uq").on(table.id, table.organizationId, table.centreId), foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "sample_procedure_centre_fk" }), foreignKey({ columns: [table.approvedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "sample_procedure_approver_fk" }), foreignKey({ columns: [table.revokedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "sample_procedure_revoker_fk" })]);

export const specimens = pgTable("specimens", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), jobId: uuid("job_id").notNull(), orderId: uuid("order_id").notNull(), patientId: uuid("patient_id").notNull(), specimenNumber: varchar("specimen_number", { length: 32 }).notNull(), idempotencyKey: uuid("idempotency_key").notNull(),privateDataCiphertext: text("private_data_ciphertext").notNull(), status: varchar("status", { length: 28 }).notNull(), identityCheckConfirmed: boolean("identity_check_confirmed").notNull(), collectionProcedureApprovalId: uuid("collection_procedure_approval_id").notNull(), collectedByStaffId: uuid("collected_by_staff_id").notNull(), collectedAt: timestamp("collected_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(), receivingSubmissionRequired: boolean("receiving_submission_required").notNull().default(false), receivedByStaffId: uuid("received_by_staff_id"), receivedAt: timestamp("received_at", { withTimezone: true, mode: "date" }), receivingProcedureApprovalId: uuid("receiving_procedure_approval_id"), dispatchBatchId: uuid("dispatch_batch_id"), versionNumber: integer("version_number").notNull().default(1), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("specimens_org_number_uq").on(table.organizationId, table.specimenNumber), uniqueIndex("specimens_idempotency_uq").on(table.organizationId, table.idempotencyKey), uniqueIndex("specimens_scope_uq").on(table.id, table.organizationId, table.centreId), foreignKey({ columns: [table.jobId, table.organizationId, table.centreId], foreignColumns: [collectionJobs.id, collectionJobs.organizationId, collectionJobs.centreId], name: "specimens_job_fk" }), foreignKey({ columns: [table.orderId, table.organizationId, table.centreId], foreignColumns: [diagnosticOrders.id, diagnosticOrders.organizationId, diagnosticOrders.centreId], name: "specimens_order_fk" }), foreignKey({ columns: [table.patientId, table.organizationId, table.centreId], foreignColumns: [patients.id, patients.organizationId, patients.centreId], name: "specimens_patient_fk" }), foreignKey({ columns: [table.collectionProcedureApprovalId, table.organizationId, table.centreId], foreignColumns: [sampleProcedureApprovals.id, sampleProcedureApprovals.organizationId, sampleProcedureApprovals.centreId], name: "specimens_collection_procedure_fk" }), foreignKey({ columns: [table.receivingProcedureApprovalId, table.organizationId, table.centreId], foreignColumns: [sampleProcedureApprovals.id, sampleProcedureApprovals.organizationId, sampleProcedureApprovals.centreId], name: "specimens_receiving_procedure_fk" }), foreignKey({ columns: [table.collectedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "specimens_collector_fk" }), foreignKey({ columns: [table.receivedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "specimens_receiver_fk" }), index("specimens_status_idx").on(table.organizationId, table.centreId, table.status, table.collectedAt), index("specimens_order_idx").on(table.organizationId, table.orderId)]);

export const dispatchBatches = pgTable("dispatch_batches", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), batchNumber: varchar("batch_number", { length: 32 }).notNull(), status: varchar("status", { length: 20 }).notNull(),privateDataCiphertext: text("private_data_ciphertext").notNull(), handedOverByStaffId: uuid("handed_over_by_staff_id"), handedOverAt: timestamp("handed_over_at", { withTimezone: true, mode: "date" }), transportProcedureApprovalId: uuid("transport_procedure_approval_id"), versionNumber: integer("version_number").notNull().default(1), createdByStaffId: uuid("created_by_staff_id").notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("dispatch_batches_org_number_uq").on(table.organizationId, table.batchNumber), uniqueIndex("dispatch_batches_scope_uq").on(table.id, table.organizationId, table.centreId), foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "dispatch_batches_centre_fk" }), foreignKey({ columns: [table.handedOverByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "dispatch_batches_handover_actor_fk" }), foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "dispatch_batches_creator_fk" }), foreignKey({ columns: [table.transportProcedureApprovalId, table.organizationId, table.centreId], foreignColumns: [sampleProcedureApprovals.id, sampleProcedureApprovals.organizationId, sampleProcedureApprovals.centreId], name: "dispatch_batches_transport_procedure_fk" })]);

export const dispatchBatchItems = pgTable("dispatch_batch_items", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), batchId: uuid("batch_id").notNull(), specimenId: uuid("specimen_id").notNull(), addedByStaffId: uuid("added_by_staff_id").notNull(), addedAt: timestamp("added_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [uniqueIndex("dispatch_batch_items_batch_specimen_uq").on(table.batchId, table.specimenId), uniqueIndex("dispatch_batch_items_specimen_uq").on(table.specimenId), foreignKey({ columns: [table.batchId, table.organizationId, table.centreId], foreignColumns: [dispatchBatches.id, dispatchBatches.organizationId, dispatchBatches.centreId], name: "dispatch_batch_items_batch_fk" }), foreignKey({ columns: [table.specimenId, table.organizationId, table.centreId], foreignColumns: [specimens.id, specimens.organizationId, specimens.centreId], name: "dispatch_batch_items_specimen_fk" }), foreignKey({ columns: [table.addedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "dispatch_batch_items_actor_fk" })]);

export const sampleCustodyEvents = pgTable("sample_custody_events", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), specimenId: uuid("specimen_id").notNull(), eventType: varchar("event_type", { length: 32 }).notNull(), source: varchar("source", { length: 24 }).notNull(),privateDataCiphertext: text("private_data_ciphertext").notNull(), actorStaffId: uuid("actor_staff_id").notNull(), idempotencyKey: uuid("idempotency_key"), recordedAt: recordedAt(),
}, (table) => [foreignKey({ columns: [table.specimenId, table.organizationId, table.centreId], foreignColumns: [specimens.id, specimens.organizationId, specimens.centreId], name: "sample_custody_events_specimen_fk" }), foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "sample_custody_events_actor_fk" }), index("sample_custody_events_idx").on(table.organizationId, table.specimenId, table.recordedAt), uniqueIndex("sample_custody_events_idempotency_uq").on(table.organizationId, table.idempotencyKey).where(sql`${table.idempotencyKey} IS NOT NULL`)]);

export const sampleExternalReceipts = pgTable("sample_external_receipts", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), batchId: uuid("batch_id").notNull(),privateDataCiphertext: text("private_data_ciphertext").notNull(), verificationStatus: varchar("verification_status", { length: 20 }).notNull(), recordedByStaffId: uuid("recorded_by_staff_id").notNull(), verifiedByStaffId: uuid("verified_by_staff_id"), recordedAt: recordedAt(), verifiedAt: timestamp("verified_at", { withTimezone: true, mode: "date" }),
}, (table) => [foreignKey({ columns: [table.batchId, table.organizationId, table.centreId], foreignColumns: [dispatchBatches.id, dispatchBatches.organizationId, dispatchBatches.centreId], name: "sample_external_receipts_batch_fk" }), foreignKey({ columns: [table.recordedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "sample_external_receipts_recorder_fk" }), foreignKey({ columns: [table.verifiedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "sample_external_receipts_verifier_fk" })]);

export const sampleExceptions = pgTable("sample_exceptions", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), specimenId: uuid("specimen_id").notNull(), exceptionType: varchar("exception_type", { length: 32 }).notNull(),privateDataCiphertext: text("private_data_ciphertext").notNull(), status: varchar("status", { length: 16 }).notNull(), recordedByStaffId: uuid("recorded_by_staff_id").notNull(), resolvedByStaffId: uuid("resolved_by_staff_id"), createdAt: createdAt(), resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
}, (table) => [foreignKey({ columns: [table.specimenId, table.organizationId, table.centreId], foreignColumns: [specimens.id, specimens.organizationId, specimens.centreId], name: "sample_exceptions_specimen_fk" }), foreignKey({ columns: [table.recordedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "sample_exceptions_recorder_fk" }), foreignKey({ columns: [table.resolvedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "sample_exceptions_resolver_fk" })]);

export const staffApprovalPolicies = pgTable("staff_approval_policies", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id"), actionType: varchar("action_type", { length: 40 }).notNull(), enabled: boolean("enabled").notNull().default(false), approverPermission: varchar("approver_permission", { length: 40 }).notNull(), escalationAfterMinutes: integer("escalation_after_minutes"), escalationOwnerStaffId: uuid("escalation_owner_staff_id"), expireAfterMinutes: integer("expire_after_minutes"), versionNumber: integer("version_number").notNull().default(1), createdByStaffId: uuid("created_by_staff_id").notNull(), updatedByStaffId: uuid("updated_by_staff_id").notNull(), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("staff_approval_policies_id_org_uq").on(table.id, table.organizationId), foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "staff_approval_policies_centre_fk" }), foreignKey({ columns: [table.escalationOwnerStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_approval_policies_escalation_owner_fk" }), foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_approval_policies_creator_fk" }), foreignKey({ columns: [table.updatedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_approval_policies_updater_fk" })]);

export const staffApprovalPolicyApprovers = pgTable("staff_approval_policy_approvers", {
  id: id(), organizationId: uuid("organization_id").notNull(), policyId: uuid("policy_id").notNull(), staffId: uuid("staff_id").notNull(), createdByStaffId: uuid("created_by_staff_id").notNull(), createdAt: createdAt(),
}, (table) => [uniqueIndex("staff_approval_policy_approvers_uq").on(table.policyId, table.staffId), foreignKey({ columns: [table.policyId, table.organizationId], foreignColumns: [staffApprovalPolicies.id, staffApprovalPolicies.organizationId], name: "staff_approval_policy_approvers_policy_fk" }), foreignKey({ columns: [table.staffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_approval_policy_approvers_staff_fk" }), foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_approval_policy_approvers_creator_fk" })]);

export const staffTasks = pgTable("staff_tasks", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), taskNumber: varchar("task_number", { length: 32 }).notNull(), privateDataCiphertext: text("private_data_ciphertext").notNull(), taskType: varchar("task_type", { length: 24 }).notNull(), priority: varchar("priority", { length: 12 }).notNull(), status: varchar("status", { length: 24 }).notNull(), requiresApproval: boolean("requires_approval").notNull().default(false), approvalStatus: varchar("approval_status", { length: 24 }).notNull(), approvalPolicyId: uuid("approval_policy_id"), approvalExpiresAt: timestamp("approval_expires_at", { withTimezone: true, mode: "date" }), escalationOwnerStaffId: uuid("escalation_owner_staff_id"), escalationDueAt: timestamp("escalation_due_at", { withTimezone: true, mode: "date" }), escalationProcessedAt: timestamp("escalation_processed_at", { withTimezone: true, mode: "date" }), assignedStaffId: uuid("assigned_staff_id").notNull(), createdByStaffId: uuid("created_by_staff_id").notNull(), approvedByStaffId: uuid("approved_by_staff_id"), approvedAt: timestamp("approved_at", { withTimezone: true, mode: "date" }), dueAt: timestamp("due_at", { withTimezone: true, mode: "date" }), idempotencyKey: uuid("idempotency_key").notNull(), requestHash: varchar("request_hash", { length: 64 }).notNull(), versionNumber: integer("version_number").notNull().default(1), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("staff_tasks_org_number_uq").on(table.organizationId, table.taskNumber), uniqueIndex("staff_tasks_idempotency_uq").on(table.organizationId, table.idempotencyKey), uniqueIndex("staff_tasks_scope_uq").on(table.id, table.organizationId, table.centreId), foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "staff_tasks_centre_fk" }), foreignKey({ columns: [table.approvalPolicyId, table.organizationId], foreignColumns: [staffApprovalPolicies.id, staffApprovalPolicies.organizationId], name: "staff_tasks_approval_policy_fk" }), foreignKey({ columns: [table.escalationOwnerStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_tasks_escalation_owner_fk" }), foreignKey({ columns: [table.assignedStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_tasks_assignee_fk" }), foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_tasks_creator_fk" }), foreignKey({ columns: [table.approvedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_tasks_approver_fk" }), index("staff_tasks_queue_idx").on(table.organizationId, table.centreId, table.status, table.priority, table.dueAt), index("staff_tasks_assignee_idx").on(table.organizationId, table.assignedStaffId, table.status, table.dueAt), index("staff_tasks_escalation_lookup_idx").on(table.organizationId, table.centreId, table.escalationDueAt), index("staff_tasks_approval_expiry_idx").on(table.organizationId, table.centreId, table.approvalExpiresAt)]);

export const staffTaskEvents = pgTable("staff_task_events", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), taskId: uuid("task_id").notNull(), eventType: varchar("event_type", { length: 24 }).notNull(), privateDataCiphertext: text("private_data_ciphertext").notNull(), actorType: varchar("actor_type", { length: 12 }).notNull().default("STAFF"), actorStaffId: uuid("actor_staff_id"), idempotencyKey: uuid("idempotency_key"), requestHash: varchar("request_hash", { length: 64 }), recordedAt: recordedAt(),
}, (table) => [foreignKey({ columns: [table.taskId, table.organizationId, table.centreId], foreignColumns: [staffTasks.id, staffTasks.organizationId, staffTasks.centreId], name: "staff_task_events_task_fk" }), foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_task_events_actor_fk" }), index("staff_task_events_task_idx").on(table.organizationId, table.taskId, table.recordedAt), uniqueIndex("staff_task_events_idempotency_uq").on(table.organizationId, table.idempotencyKey).where(sql`${table.idempotencyKey} IS NOT NULL`)]);

export const staffEscalations = pgTable("staff_escalations", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), escalationNumber: varchar("escalation_number", { length: 32 }).notNull(), sourceType: varchar("source_type", { length: 24 }).notNull(), sourceId: uuid("source_id").notNull(), privateDataCiphertext: text("private_data_ciphertext").notNull(), severity: varchar("severity", { length: 12 }).notNull(), priority: varchar("priority", { length: 12 }).notNull(), status: varchar("status", { length: 16 }).notNull().default("OPEN"), assignedOwnerStaffId: uuid("assigned_owner_staff_id").notNull(), createdByStaffId: uuid("created_by_staff_id").notNull(), dueAt: timestamp("due_at", { withTimezone: true, mode: "date" }).notNull(), resolvedByStaffId: uuid("resolved_by_staff_id"), resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }), idempotencyKey: uuid("idempotency_key").notNull(), requestHash: varchar("request_hash", { length: 64 }).notNull(), versionNumber: integer("version_number").notNull().default(1), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("staff_escalations_org_number_uq").on(table.organizationId, table.escalationNumber), uniqueIndex("staff_escalations_idempotency_uq").on(table.organizationId, table.idempotencyKey), uniqueIndex("staff_escalations_scope_uq").on(table.id, table.organizationId, table.centreId), foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "staff_escalations_centre_fk" }), foreignKey({ columns: [table.assignedOwnerStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_escalations_owner_fk" }), foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_escalations_creator_fk" }), foreignKey({ columns: [table.resolvedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_escalations_resolver_fk" }), index("staff_escalations_queue_idx").on(table.organizationId, table.centreId, table.status, table.dueAt, table.severity), index("staff_escalations_owner_idx").on(table.organizationId, table.assignedOwnerStaffId, table.status, table.dueAt)]);

export const staffEscalationEvents = pgTable("staff_escalation_events", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), escalationId: uuid("escalation_id").notNull(), eventType: varchar("event_type", { length: 20 }).notNull(), privateDataCiphertext: text("private_data_ciphertext").notNull(), actorStaffId: uuid("actor_staff_id").notNull(), idempotencyKey: uuid("idempotency_key"), requestHash: varchar("request_hash", { length: 64 }), recordedAt: recordedAt(),
}, (table) => [foreignKey({ columns: [table.escalationId, table.organizationId, table.centreId], foreignColumns: [staffEscalations.id, staffEscalations.organizationId, staffEscalations.centreId], name: "staff_escalation_events_escalation_fk" }), foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_escalation_events_actor_fk" }), index("staff_escalation_events_history_idx").on(table.organizationId, table.escalationId, table.recordedAt), uniqueIndex("staff_escalation_events_idempotency_uq").on(table.organizationId, table.idempotencyKey)]);

export const staffShifts = pgTable("staff_shifts", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), staffId: uuid("staff_id").notNull(), shiftType: varchar("shift_type", { length: 20 }).notNull(), status: varchar("status", { length: 16 }).notNull().default("ACTIVE"), startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(), endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(), timeZone: varchar("time_zone", { length: 64 }).notNull(), privateDataCiphertext: text("private_data_ciphertext").notNull(), createdByStaffId: uuid("created_by_staff_id").notNull(), idempotencyKey: uuid("idempotency_key").notNull(), requestHash: varchar("request_hash", { length: 64 }).notNull(), versionNumber: integer("version_number").notNull().default(1), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("staff_shifts_idempotency_uq").on(table.organizationId, table.idempotencyKey), uniqueIndex("staff_shifts_scope_uq").on(table.id, table.organizationId, table.centreId), foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "staff_shifts_centre_fk" }), foreignKey({ columns: [table.staffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_shifts_staff_fk" }), foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_shifts_creator_fk" }), index("staff_shifts_schedule_idx").on(table.organizationId, table.centreId, table.startsAt, table.endsAt, table.status), index("staff_shifts_person_idx").on(table.organizationId, table.staffId, table.startsAt, table.status)]);

export const staffShiftEvents = pgTable("staff_shift_events", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), shiftId: uuid("shift_id").notNull(), eventType: varchar("event_type", { length: 20 }).notNull(), privateDataCiphertext: text("private_data_ciphertext").notNull(), actorStaffId: uuid("actor_staff_id").notNull(), idempotencyKey: uuid("idempotency_key"), requestHash: varchar("request_hash", { length: 64 }), recordedAt: recordedAt(),
}, (table) => [foreignKey({ columns: [table.shiftId, table.organizationId, table.centreId], foreignColumns: [staffShifts.id, staffShifts.organizationId, staffShifts.centreId], name: "staff_shift_events_shift_fk" }), foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_shift_events_actor_fk" }), index("staff_shift_events_shift_idx").on(table.organizationId, table.shiftId, table.recordedAt), uniqueIndex("staff_shift_events_idempotency_uq").on(table.organizationId, table.idempotencyKey)]);

export const staffShiftHandovers = pgTable("staff_shift_handovers", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), outgoingShiftId: uuid("outgoing_shift_id").notNull(), outgoingStaffId: uuid("outgoing_staff_id").notNull(), incomingStaffId: uuid("incoming_staff_id").notNull(), status: varchar("status", { length: 16 }).notNull().default("PENDING"), privateDataCiphertext: text("private_data_ciphertext").notNull(), idempotencyKey: uuid("idempotency_key").notNull(), requestHash: varchar("request_hash", { length: 64 }).notNull(), versionNumber: integer("version_number").notNull().default(1), createdByStaffId: uuid("created_by_staff_id").notNull(), acknowledgedByStaffId: uuid("acknowledged_by_staff_id"), acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true, mode: "date" }), createdAt: createdAt(), updatedAt: updatedAt(),
}, (table) => [uniqueIndex("staff_shift_handovers_idempotency_uq").on(table.organizationId, table.idempotencyKey), uniqueIndex("staff_shift_handovers_scope_uq").on(table.id, table.organizationId, table.centreId), uniqueIndex("staff_shift_handovers_one_active_per_shift_uq").on(table.organizationId, table.outgoingShiftId).where(sql`${table.status} <> 'CANCELLED'`), foreignKey({ columns: [table.outgoingShiftId, table.organizationId, table.centreId], foreignColumns: [staffShifts.id, staffShifts.organizationId, staffShifts.centreId], name: "staff_shift_handovers_shift_fk" }), foreignKey({ columns: [table.outgoingStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_shift_handovers_outgoing_staff_fk" }), foreignKey({ columns: [table.incomingStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_shift_handovers_incoming_staff_fk" }), foreignKey({ columns: [table.createdByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_shift_handovers_creator_fk" }), foreignKey({ columns: [table.acknowledgedByStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_shift_handovers_acknowledger_fk" }), index("staff_shift_handovers_incoming_queue_idx").on(table.organizationId, table.centreId, table.incomingStaffId, table.status, table.createdAt)]);

export const staffShiftHandoverEvents = pgTable("staff_shift_handover_events", {
  id: id(), organizationId: uuid("organization_id").notNull(), centreId: uuid("centre_id").notNull(), handoverId: uuid("handover_id").notNull(), eventType: varchar("event_type", { length: 20 }).notNull(), privateDataCiphertext: text("private_data_ciphertext").notNull(), actorStaffId: uuid("actor_staff_id").notNull(), idempotencyKey: uuid("idempotency_key"), requestHash: varchar("request_hash", { length: 64 }), recordedAt: recordedAt(),
}, (table) => [uniqueIndex("staff_shift_handover_events_idempotency_uq").on(table.organizationId, table.idempotencyKey).where(sql`${table.idempotencyKey} IS NOT NULL`), foreignKey({ columns: [table.handoverId, table.organizationId, table.centreId], foreignColumns: [staffShiftHandovers.id, staffShiftHandovers.organizationId, staffShiftHandovers.centreId], name: "staff_shift_handover_events_handover_fk" }), foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "staff_shift_handover_events_actor_fk" }), index("staff_shift_handover_events_history_idx").on(table.organizationId, table.handoverId, table.recordedAt)]);

export const applicationConfiguration = pgTable("application_configuration", {
  key: varchar("key", { length: 120 }).primaryKey(),
  value: jsonb("value").notNull(),
  updatedByStaffId: uuid("updated_by_staff_id").references(() => staffUsers.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const auditEvents = pgTable("audit_events", {
  sequence: bigint("sequence", { mode: "number" }).generatedAlwaysAsIdentity().notNull().unique(),
  id: id(),
  organizationId: uuid("organization_id").references(() => organizations.id, { onDelete: "restrict" }),
  centreId: uuid("centre_id").references(() => centres.id, { onDelete: "restrict" }),
  actorStaffId: uuid("actor_staff_id").references(() => staffUsers.id, { onDelete: "restrict" }),
  action: varchar("action", { length: 120 }).notNull(),
  entityType: varchar("entity_type", { length: 80 }).notNull(),
  entityId: text("entity_id"),
  details: jsonb("details").notNull().default({}),
  previousHash: varchar("previous_hash", { length: 64 }).notNull(),
  eventHash: varchar("event_hash", { length: 64 }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("audit_events_id_uq").on(table.id),
  uniqueIndex("audit_events_hash_uq").on(table.eventHash),
  index("audit_events_org_seq_idx").on(table.organizationId, table.sequence),
  index("audit_events_task_policy_idempotency_idx").on(table.organizationId, sql`(${table.details}->>'idempotencyKey')`).where(sql`${table.entityType} = 'staff_approval_policy' AND ${table.action} = 'staff_approval_policy.updated' AND ${table.details} ? 'idempotencyKey'`),
  uniqueIndex("audit_events_mutation_idempotency_uq").on(table.organizationId, sql`(${table.details}->>'mutationIdempotencyKey')`).where(sql`${table.details} ? 'mutationIdempotencyKey'`),
  foreignKey({ columns: [table.centreId, table.organizationId], foreignColumns: [centres.id, centres.organizationId], name: "audit_events_centre_org_fk" }),
  foreignKey({ columns: [table.actorStaffId, table.organizationId], foreignColumns: [staffUsers.id, staffUsers.organizationId], name: "audit_events_actor_org_fk" }),
]);

export const organizationsRelations = relations(organizations, ({ many }) => ({ centres: many(centres), staff: many(staffUsers), roles: many(roles) }));
export const centresRelations = relations(centres, ({ one, many }) => ({ organization: one(organizations, { fields: [centres.organizationId], references: [organizations.id] }), assignments: many(staffRoleAssignments) }));
export const staffUsersRelations = relations(staffUsers, ({ one, many }) => ({ organization: one(organizations, { fields: [staffUsers.organizationId], references: [organizations.id] }), externalIdentity: one(externalIdentities), assignments: many(staffRoleAssignments) }));
export const rolesRelations = relations(roles, ({ one, many }) => ({ organization: one(organizations, { fields: [roles.organizationId], references: [organizations.id] }), permissions: many(rolePermissions), assignments: many(staffRoleAssignments) }));
export const rolePermissionsRelations = relations(rolePermissions, ({ one }) => ({ role: one(roles, { fields: [rolePermissions.roleId], references: [roles.id] }), permission: one(permissions, { fields: [rolePermissions.permissionId], references: [permissions.id] }) }));
export const staffRoleAssignmentsRelations = relations(staffRoleAssignments, ({ one }) => ({ staffUser: one(staffUsers, { fields: [staffRoleAssignments.staffUserId], references: [staffUsers.id] }), role: one(roles, { fields: [staffRoleAssignments.roleId], references: [roles.id] }), centre: one(centres, { fields: [staffRoleAssignments.centreId], references: [centres.id] }) }));
export const externalIdentitiesRelations = relations(externalIdentities, ({ one }) => ({ staffUser: one(staffUsers, { fields: [externalIdentities.staffUserId], references: [staffUsers.id] }) }));

export const applicationSchema = {
  organizations, centres, centrePublicProfiles, staffUsers, externalIdentities, roles, permissions,
  rolePermissions, staffRoleAssignments, organizationSequences, patients, patientRelationships, families, familyMembers, familyAccessGrants, familyContactArrangements, leads, leadPrivateData, publicEnquiries, publicEnquiryEvents, leadActivities, leadQuotes, leadFollowups, leadConversions, appointments, appointmentServices, appointmentStatusHistory, appointmentAssignmentHistory, appointmentArrivalEvents, appointmentQueueTokens, appointmentQueueEvents, catalogueImportBatches, diagnosticCatalogueItems, diagnosticCatalogueVersions, diagnosticPackageComponents, cataloguePriceReviews, diagnosticOrders, diagnosticOrderItems, diagnosticOrderStatusHistory, staffTasks, staffTaskEvents, staffEscalations, staffEscalationEvents, staffShifts, staffShiftEvents, staffShiftHandovers, staffShiftHandoverEvents, applicationConfiguration, auditEvents,
  authUser, authSession, authAccount,
};
