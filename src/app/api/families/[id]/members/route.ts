import { randomUUID } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { getDb } from "@/db/client";
import { familyMembers, families, patientContactSecrets, patients } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { canAccessFamilyCentre, familyMemberCreateSchema } from "@/server/family-policy";
import { blindIndexPatientContact, decryptPatientIdentity, encryptPatientContacts, encryptPatientIdentity } from "@/server/patient-contact-crypto";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  const access = await getApiAccess("families.read");
  if (access.response) return access.response;
  const [family] = await getDb().select({ id: families.id, organizationId: families.organizationId, centreId: families.centreId }).from(families).where(and(eq(families.id, id), eq(families.organizationId, access.staff.organizationId))).limit(1);
  if (!family || !canAccessFamilyCentre(access.staff.grants, "families.read", family.centreId) || !canAccessFamilyCentre(access.staff.grants, "patients.read", family.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const rows = await getDb().select({ id: familyMembers.id, patientId: patients.id, patientNumber: patients.patientNumber, centreId:patients.centreId,encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext,relationship: familyMembers.relationship, status: familyMembers.status, authorizationBasis: familyMembers.authorizationBasis, verifiedAt: familyMembers.verifiedAt, createdAt: familyMembers.createdAt }).from(familyMembers).innerJoin(patients, eq(patients.id, familyMembers.patientId)).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId))).where(and(eq(familyMembers.organizationId, family.organizationId), eq(familyMembers.familyId, family.id)));
  return Response.json({ members: rows.map(({ encryptionKeyId,nameCiphertext,centreId,...member }) => ({ ...member, ...decryptPatientIdentity({encryptionKeyId,nameCiphertext},{organizationId:family.organizationId,centreId,patientId:member.patientId}) })) });
}

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id: familyId } = await params;
  const parsed = familyMemberCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const access = await getApiAccess("families.members.manage");
  if (access.response) return access.response;
  const db = getDb();
  const [family] = await db.select({ id: families.id, organizationId: families.organizationId, centreId: families.centreId, primaryContactPatientId: families.primaryContactPatientId }).from(families).where(and(eq(families.id, familyId), eq(families.organizationId, access.staff.organizationId))).limit(1);
  if (!family || !canAccessFamilyCentre(access.staff.grants, "families.members.manage", family.centreId) || !canAccessFamilyCentre(access.staff.grants, "patients.read", family.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (parsed.data.newPatient) {
    if (parsed.data.newPatient.centreId !== family.centreId) return Response.json({ error: "patient_centre_mismatch" }, { status: 400 });
    const patientAccess = await getApiAccess("patients.create", family.centreId);
    if (patientAccess.response) return patientAccess.response;
  }
  const patientId = parsed.data.patientId ?? randomUUID();
  const patientNumber = `RHC-${new Date().getFullYear()}-${patientId.slice(0, 8).toUpperCase()}`;
  try {
    const member = await db.transaction(async (tx) => {
      const [lockedFamily] = await tx.select({ id: families.id, primaryContactPatientId: families.primaryContactPatientId }).from(families).where(and(eq(families.id, family.id), eq(families.organizationId, family.organizationId))).for("update").limit(1);
      if (!lockedFamily) throw new Error("family_missing");
      if (parsed.data.newPatient) {
        const patientData = parsed.data.newPatient;
        const email = patientData.email?.toLowerCase() || null;
        const phoneIndex=blindIndexPatientContact("phone",patientData.phone);const emailIndex=email?blindIndexPatientContact("email",email):null;
        const [duplicate] = await tx.select({ id: patientContactSecrets.patientId }).from(patientContactSecrets).where(and(eq(patientContactSecrets.organizationId, family.organizationId), eq(patientContactSecrets.centreId, family.centreId), or(eq(patientContactSecrets.phoneBlindIndex,phoneIndex),emailIndex?eq(patientContactSecrets.emailBlindIndex,emailIndex):undefined))).limit(1);
        if (duplicate) throw new Error("possible_duplicate_review_required");
        await tx.insert(patients).values({ id: patientId, organizationId: family.organizationId, centreId: family.centreId, patientNumber, consentStatus: patientData.consentStatus, consentMethod: patientData.consentMethod ?? null, consentRecordedAt: patientData.consentStatus === "NOT_RECORDED" ? null : new Date(), createdByStaffId: access.staff.staffUserId });
        const context={organizationId:family.organizationId,centreId:family.centreId,patientId};
        await tx.insert(patientContactSecrets).values({patientId,organizationId:family.organizationId,centreId:family.centreId,...encryptPatientContacts({phone:patientData.phone,email,profile:{preferredName:patientData.preferredName??null,dateOfBirth:patientData.dateOfBirth,sexAtRegistration:patientData.sexAtRegistration??null,address:patientData.address??null}},context),...encryptPatientIdentity({firstName:patientData.firstName,lastName:patientData.lastName},context)});
        await appendAuditEvent(tx, { organizationId: family.organizationId, centreId: family.centreId, actorStaffId: access.staff.staffUserId, action: "patient.registered", entityType: "patient", entityId: patientId, details: { source: "family_member_registration", consentStatus: patientData.consentStatus } });
      } else {
        const [existing] = await tx.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.organizationId, family.organizationId), eq(patients.centreId, family.centreId))).limit(1);
        if (!existing) throw new Error("patient_not_found_in_scope");
      }
      const existingMembers = await tx.select({ patientId: familyMembers.patientId }).from(familyMembers).where(and(eq(familyMembers.organizationId, family.organizationId), eq(familyMembers.familyId, family.id), inArray(familyMembers.status, ["PENDING_VERIFICATION", "ACTIVE"])));
      const relationship = parsed.data.relationship;
      if (relationship === "SELF" && existingMembers.length > 0) throw new Error("self_relationship_invalid");
      if (relationship !== "SELF" && existingMembers.length === 0) throw new Error("first_member_must_be_self");
      const [created] = await tx.insert(familyMembers).values({ organizationId: family.organizationId, centreId: family.centreId, familyId: family.id, patientId, relationship, status: "PENDING_VERIFICATION", createdByStaffId: access.staff.staffUserId }).returning({ id: familyMembers.id, patientId: familyMembers.patientId, relationship: familyMembers.relationship, status: familyMembers.status });
      if (!lockedFamily.primaryContactPatientId && existingMembers.length === 0) await tx.update(families).set({ primaryContactPatientId: patientId, updatedAt: new Date() }).where(eq(families.id, family.id));
      await appendAuditEvent(tx, { organizationId: family.organizationId, centreId: family.centreId, actorStaffId: access.staff.staffUserId, action: "family.member.added", entityType: "family", entityId: family.id, details: { relationship, status: "PENDING_VERIFICATION" } });
      const [person] = await tx.select({ patientNumber: patients.patientNumber, centreId:patients.centreId,encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext }).from(patients).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId))).where(eq(patients.id, patientId)).limit(1);
      const identity=decryptPatientIdentity(person,{organizationId:family.organizationId,centreId:person.centreId,patientId});
      return { ...created, patientNumber: person.patientNumber, name: `${identity.firstName} ${identity.lastName}` };
    });
    return Response.json({ member }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "possible_duplicate_review_required") return Response.json({ error: "possible_duplicate_review_required" }, { status: 409 });
    if (error instanceof Error && error.message === "patient_not_found_in_scope") return Response.json({ error: "patient_not_found_in_scope" }, { status: 404 });
    if (error instanceof Error && ["self_relationship_invalid", "first_member_must_be_self"].includes(error.message)) return Response.json({ error: error.message }, { status: 409 });
    return Response.json({ error: "family_member_add_unavailable" }, { status: 409 });
  }
}
