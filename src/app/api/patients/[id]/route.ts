import { and, desc, eq, ne, or } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { getDb } from "@/db/client";
import { auditEvents, families, familyMembers, patientContactSecrets, patientRelationships, patients } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { canAccessPatientCentre, patientUpdateSchema } from "@/server/patient-policy";
import { canAccessFamilyCentre } from "@/server/family-policy";
import { blindIndexPatientContact, decryptPatientContacts, decryptPatientIdentity, encryptPatientContacts, encryptPatientIdentity } from "@/server/patient-contact-crypto";
import { decryptFamilyValue } from "@/server/family-crypto";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteContext) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("patients.read");
  if (access.response) return access.response;
  const db = getDb();
  const [storedPatient] = await db.select({
    id: patients.id, centreId: patients.centreId,encryptionKeyId:patientContactSecrets.encryptionKeyId,
    patientNumber: patients.patientNumber, nameCiphertext:patientContactSecrets.nameCiphertext,
    phoneCiphertext: patientContactSecrets.phoneCiphertext,emailCiphertext: patientContactSecrets.emailCiphertext,profileCiphertext:patientContactSecrets.profileCiphertext,
    consentStatus: patients.consentStatus,
    consentRecordedAt: patients.consentRecordedAt, consentMethod: patients.consentMethod,
    createdAt: patients.createdAt,
  }).from(patients).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId))).where(and(eq(patients.id, id), eq(patients.organizationId, access.staff.organizationId))).limit(1);
  if (!storedPatient || !canAccessPatientCentre(access.staff.grants, "patients.read", storedPatient.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const contacts=decryptPatientContacts(storedPatient,{organizationId:access.staff.organizationId,centreId:storedPatient.centreId,patientId:storedPatient.id});
  const identity=decryptPatientIdentity(storedPatient,{organizationId:access.staff.organizationId,centreId:storedPatient.centreId,patientId:storedPatient.id});
  const patient={id:storedPatient.id,centreId:storedPatient.centreId,patientNumber:storedPatient.patientNumber,...identity,consentStatus:storedPatient.consentStatus,consentRecordedAt:storedPatient.consentRecordedAt,consentMethod:storedPatient.consentMethod,createdAt:storedPatient.createdAt,phone:contacts.phone,email:contacts.email,...contacts.profile};

  const [activity, links, familyMemberships] = await Promise.all([
    db.select({ action: auditEvents.action, recordedAt: auditEvents.recordedAt }).from(auditEvents)
      .where(and(eq(auditEvents.organizationId, access.staff.organizationId), eq(auditEvents.centreId, patient.centreId), eq(auditEvents.entityType, "patient"), eq(auditEvents.entityId, patient.id)))
      .orderBy(desc(auditEvents.sequence)).limit(50),
    db.select({ id: patientRelationships.id, relationship: patientRelationships.relationship, status: patientRelationships.status, relatedPatientId: patientRelationships.relatedPatientId })
      .from(patientRelationships).where(and(eq(patientRelationships.organizationId, access.staff.organizationId), eq(patientRelationships.patientId, patient.id), eq(patientRelationships.status, "CONFIRMED"))),
    canAccessFamilyCentre(access.staff.grants,"families.read",storedPatient.centreId) ? db.select({ familyId: families.id, familyNumber: families.familyNumber, displayNameCiphertext: families.displayNameCiphertext, familyCentreId: families.centreId, relationship: familyMembers.relationship, status: familyMembers.status, primaryContact: families.primaryContactPatientId })
      .from(familyMembers).innerJoin(families, and(eq(families.id, familyMembers.familyId), eq(families.organizationId, familyMembers.organizationId), eq(families.centreId, familyMembers.centreId)))
      .where(and(eq(familyMembers.organizationId, access.staff.organizationId), eq(familyMembers.patientId, patient.id), eq(familyMembers.centreId, patient.centreId))) : Promise.resolve([]),
  ]);
  const visibleFamilyMemberships = familyMemberships.map(({displayNameCiphertext,familyCentreId,...membership}) => ({...membership,displayName:decryptFamilyValue("display-name",displayNameCiphertext,{organizationId:access.staff.organizationId,centreId:familyCentreId,recordId:membership.familyId})}));
  const familyRelationships = [];
  for (const link of links) {
    const [related] = await db.select({ id: patients.id, patientNumber: patients.patientNumber, centreId: patients.centreId, encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext })
      .from(patients).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId))).where(and(eq(patients.id, link.relatedPatientId), eq(patients.organizationId, access.staff.organizationId))).limit(1);
    if (related && canAccessPatientCentre(access.staff.grants, "patients.read", related.centreId)) {
      const relatedIdentity=decryptPatientIdentity(related,{organizationId:access.staff.organizationId,centreId:related.centreId,patientId:related.id});
      familyRelationships.push({ id: link.id, relationship: link.relationship, patient: { id: related.id, patientNumber: related.patientNumber, name: `${relatedIdentity.firstName} ${relatedIdentity.lastName}` } });
    }
  }
  return Response.json({ patient, familyRelationships, familyMemberships: visibleFamilyMemberships, activity: activity.map((entry) => ({ action: entry.action, recordedAt: entry.recordedAt })) });
}

export async function PATCH(request: Request, { params }: RouteContext) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = patientUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const access = await getApiAccess("patients.update");
  if (access.response) return access.response;
  const db = getDb();
  const [current] = await db.select({ id: patients.id, centreId: patients.centreId }).from(patients)
    .where(and(eq(patients.id, id), eq(patients.organizationId, access.staff.organizationId))).limit(1);
  if (!current || !canAccessPatientCentre(access.staff.grants, "patients.update", current.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const profileKeys=new Set(["preferredName","dateOfBirth","sexAtRegistration","address"]);
  const changes = Object.fromEntries(Object.entries(parsed.data).filter(([key,value]) => value !== undefined&&key!=="phone"&&key!=="email"&&key!=="firstName"&&key!=="lastName"&&!profileKeys.has(key)));
  try {
    const result = await db.transaction(async (tx) => {
      const [stored]=await tx.select().from(patientContactSecrets).where(and(eq(patientContactSecrets.patientId,id),eq(patientContactSecrets.organizationId,access.staff.organizationId),eq(patientContactSecrets.centreId,current.centreId))).for("update").limit(1);
      if(!stored)throw new Error("patient_contact_unavailable");
      const oldContacts=decryptPatientContacts(stored,{organizationId:access.staff.organizationId,centreId:current.centreId,patientId:id});
      const oldIdentity=decryptPatientIdentity(stored,{organizationId:access.staff.organizationId,centreId:current.centreId,patientId:id});
      const nextIdentity={firstName:parsed.data.firstName??oldIdentity.firstName,lastName:parsed.data.lastName??oldIdentity.lastName};
      const nextContacts={phone:parsed.data.phone??oldContacts.phone,email:parsed.data.email!==undefined?(parsed.data.email?.toLowerCase()||null):oldContacts.email};
      const nextProfile={...oldContacts.profile,...(parsed.data.preferredName!==undefined?{preferredName:parsed.data.preferredName}:{}),...(parsed.data.dateOfBirth!==undefined?{dateOfBirth:parsed.data.dateOfBirth}:{}),...(parsed.data.sexAtRegistration!==undefined?{sexAtRegistration:parsed.data.sexAtRegistration}:{}),...(parsed.data.address!==undefined?{address:parsed.data.address}:{})};
      if (parsed.data.phone !== undefined || parsed.data.email !== undefined) {
        const phoneIndex=blindIndexPatientContact("phone",nextContacts.phone);const emailIndex=nextContacts.email?blindIndexPatientContact("email",nextContacts.email):null;
        const duplicateMatch=or(eq(patientContactSecrets.phoneBlindIndex,phoneIndex),emailIndex?eq(patientContactSecrets.emailBlindIndex,emailIndex):undefined)!;
        const [duplicate] = await tx.select({ id: patientContactSecrets.patientId }).from(patientContactSecrets).where(and(
          eq(patientContactSecrets.organizationId, access.staff.organizationId), eq(patientContactSecrets.centreId, current.centreId),
          ne(patientContactSecrets.patientId, id), duplicateMatch,
        )).limit(1);
        if (duplicate) throw new Error("duplicate_review_required");
      }
      const consentChanges = parsed.data.consentStatus === "NOT_RECORDED"
        ? { consentMethod: null, consentRecordedAt: null }
        : parsed.data.consentStatus
          ? { consentMethod: parsed.data.consentMethod, consentRecordedAt: new Date() }
          : {};
      const values = { ...changes, ...consentChanges, updatedAt: new Date() };
      const [updated] = await tx.update(patients).set(values).where(and(eq(patients.id, id), eq(patients.organizationId, access.staff.organizationId), eq(patients.centreId, current.centreId))).returning({ id: patients.id });
      if (!updated) throw new Error("update_unavailable");
      if(parsed.data.phone!==undefined||parsed.data.email!==undefined||parsed.data.firstName!==undefined||parsed.data.lastName!==undefined||[...profileKeys].some((key)=>Object.hasOwn(parsed.data,key))){const context={organizationId:access.staff.organizationId,centreId:current.centreId,patientId:id};await tx.update(patientContactSecrets).set({...encryptPatientContacts({...nextContacts,profile:nextProfile},context),...((parsed.data.firstName!==undefined||parsed.data.lastName!==undefined)?encryptPatientIdentity(nextIdentity,context):{}),updatedAt:new Date()}).where(eq(patientContactSecrets.patientId,id));}
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: current.centreId, actorStaffId: access.staff.staffUserId, action: "patient.updated", entityType: "patient", entityId: id, details: { updatedFields: Object.keys(changes).sort().join(",") } });
      return updated;
    });
    return Response.json({ patient: result });
  } catch (error) {
    if (error instanceof Error && error.message === "duplicate_review_required") return Response.json({ error: "possible_duplicate_review_required" }, { status: 409 });
    return Response.json({ error: "patient_update_unavailable" }, { status: 409 });
  }
}
