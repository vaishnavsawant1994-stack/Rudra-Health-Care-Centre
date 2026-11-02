import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { getDb } from "@/db/client";
import { auditEvents, familyContactArrangements, familyMembers, families, patientContactSecrets, patients } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { canAccessFamilyCentre, familyUpdateSchema } from "@/server/family-policy";
import { decryptPatientIdentity } from "@/server/patient-contact-crypto";
import { blindIndexFamilyName, decryptFamilyValue, encryptFamilyValue } from "@/server/family-crypto";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("families.read");
  if (access.response) return access.response;
  const [familyRow] = await getDb().select({ id: families.id, organizationId: families.organizationId, centreId: families.centreId, familyNumber: families.familyNumber, displayNameCiphertext: families.displayNameCiphertext, primaryContactPatientId: families.primaryContactPatientId, createdAt: families.createdAt, updatedAt: families.updatedAt })
    .from(families).where(and(eq(families.id, id), eq(families.organizationId, access.staff.organizationId))).limit(1);
  if (!familyRow || !canAccessFamilyCentre(access.staff.grants, "families.read", familyRow.centreId) || !canAccessFamilyCentre(access.staff.grants, "patients.read", familyRow.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const family = { ...familyRow, displayName: decryptFamilyValue("display-name", familyRow.displayNameCiphertext, {organizationId:familyRow.organizationId,centreId:familyRow.centreId,recordId:familyRow.id})! };
  const [members, contacts, activity] = await Promise.all([
    getDb().select({ id: familyMembers.id, patientId: patients.id, patientNumber: patients.patientNumber, patientCentreId:patients.centreId,encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext,relationship: familyMembers.relationship, status: familyMembers.status, authorizationBasis: familyMembers.authorizationBasis, verifiedAt: familyMembers.verifiedAt, createdAt: familyMembers.createdAt })
      .from(familyMembers).innerJoin(patients, eq(patients.id, familyMembers.patientId)).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId)))
      .where(and(eq(familyMembers.organizationId, family.organizationId), eq(familyMembers.familyId, family.id))),
    getDb().select({ id: familyContactArrangements.id, patientId: patients.id, patientNumber: patients.patientNumber, patientCentreId:patients.centreId,encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext,channel: familyContactArrangements.channel, purpose: familyContactArrangements.purpose, status: familyContactArrangements.status, authorizationBasis: familyContactArrangements.authorizationBasis })
      .from(familyContactArrangements).innerJoin(patients, eq(patients.id, familyContactArrangements.patientId)).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId)))
      .where(and(eq(familyContactArrangements.organizationId, family.organizationId), eq(familyContactArrangements.familyId, family.id))),
    getDb().select({ action: auditEvents.action, recordedAt: auditEvents.recordedAt }).from(auditEvents)
      .where(and(eq(auditEvents.organizationId, family.organizationId), eq(auditEvents.centreId, family.centreId), eq(auditEvents.entityType, "family"), eq(auditEvents.entityId, family.id)))
      .orderBy(desc(auditEvents.sequence)).limit(100),
  ]);
  const membersWithNames=members.map(({encryptionKeyId,nameCiphertext,patientCentreId,...member})=>({...member,...decryptPatientIdentity({encryptionKeyId,nameCiphertext},{organizationId:family.organizationId,centreId:patientCentreId,patientId:member.patientId})}));
  const contactsWithNames=contacts.map(({encryptionKeyId,nameCiphertext,patientCentreId,...contact})=>{const identity=decryptPatientIdentity({encryptionKeyId,nameCiphertext},{organizationId:family.organizationId,centreId:patientCentreId,patientId:contact.patientId});return {...contact,patientName:`${identity.firstName} ${identity.lastName}`};});
  const primary = family.primaryContactPatientId ? membersWithNames.find((member) => member.patientId === family.primaryContactPatientId && member.status === "ACTIVE" && member.verifiedAt) : undefined;
  const familyGrants = access.staff.grants;
  return Response.json({
    family: { ...family, primaryContactPatientId: primary?.patientId ?? null, primaryContactName: primary ? `${primary.firstName} ${primary.lastName}` : null },
    members: membersWithNames.map(({ firstName, lastName, ...member }) => ({ ...member, name: `${firstName} ${lastName}` })),
    contacts: contactsWithNames,
    activity,
    capabilities: {
      familyManage: canAccessFamilyCentre(familyGrants, "families.update", family.centreId),
      memberManage: canAccessFamilyCentre(familyGrants, "families.members.manage", family.centreId),
      memberVerify: canAccessFamilyCentre(familyGrants, "families.members.verify", family.centreId),
      sharingManage: canAccessFamilyCentre(familyGrants, "families.sharing.manage", family.centreId),
      sharingVerify: canAccessFamilyCentre(familyGrants, "families.sharing.verify", family.centreId),
    },
  });
}

export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = familyUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const access = await getApiAccess("families.update");
  if (access.response) return access.response;
  const db = getDb();
  const [current] = await db.select({ centreId: families.centreId, displayNameCiphertext:families.displayNameCiphertext }).from(families).where(and(eq(families.id, id), eq(families.organizationId, access.staff.organizationId))).limit(1);
  if (!current || !canAccessFamilyCentre(access.staff.grants, "families.update", current.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (parsed.data.primaryContactPatientId) {
    if (!canAccessFamilyCentre(access.staff.grants, "patients.read", current.centreId)) return Response.json({ error: "forbidden" }, { status: 403 });
    const [verifiedMember] = await db.select({ id: familyMembers.id }).from(familyMembers).where(and(
      eq(familyMembers.organizationId, access.staff.organizationId), eq(familyMembers.familyId, id), eq(familyMembers.patientId, parsed.data.primaryContactPatientId), eq(familyMembers.status, "ACTIVE"),
    )).limit(1);
    if (!verifiedMember) return Response.json({ error: "primary_contact_must_be_verified_family_member" }, { status: 409 });
  }
  try {
    const updated = await db.transaction(async (tx) => {
      const locked = await tx.select({ id: families.id }).from(families).where(and(eq(families.id, id), eq(families.organizationId, access.staff.organizationId))).for("update").limit(1);
      if (!locked.length) throw new Error("family_missing");
      if (parsed.data.primaryContactPatientId) {
        const [verifiedMember] = await tx.select({ id: familyMembers.id }).from(familyMembers).where(and(
          eq(familyMembers.organizationId, access.staff.organizationId), eq(familyMembers.familyId, id), eq(familyMembers.patientId, parsed.data.primaryContactPatientId), eq(familyMembers.status, "ACTIVE"),
        )).limit(1);
        if (!verifiedMember) throw new Error("primary_contact_membership_changed");
      }
      const [row] = await tx.update(families).set({ ...(parsed.data.displayName !== undefined ? { displayNameCiphertext: encryptFamilyValue("display-name", parsed.data.displayName, {organizationId:access.staff.organizationId,centreId:current.centreId,recordId:id}), displayNameBlindIndex: blindIndexFamilyName(parsed.data.displayName) } : {}), ...(parsed.data.primaryContactPatientId !== undefined ? { primaryContactPatientId: parsed.data.primaryContactPatientId } : {}), updatedAt: new Date() }).where(and(eq(families.id, id), eq(families.organizationId, access.staff.organizationId))).returning({ id: families.id, primaryContactPatientId: families.primaryContactPatientId });
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: current.centreId, actorStaffId: access.staff.staffUserId, action: "family.updated", entityType: "family", entityId: id, details: { updatedFields: Object.keys(parsed.data).sort().join(",") } });
      return row;
    });
    return Response.json({ family: { ...updated, displayName: parsed.data.displayName ?? decryptFamilyValue("display-name",current.displayNameCiphertext,{organizationId:access.staff.organizationId,centreId:current.centreId,recordId:id}) } });
  } catch { return Response.json({ error: "family_update_unavailable" }, { status: 409 }); }
}
