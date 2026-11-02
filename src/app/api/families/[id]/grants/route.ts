import { and, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { getDb } from "@/db/client";
import { familyAccessGrants, familyMembers, families, patientContactSecrets, patients } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { canAccessFamilyCentre, familyGrantCreateSchema } from "@/server/family-policy";
import { z } from "zod";
import { decryptPatientIdentity } from "@/server/patient-contact-crypto";
import { decryptFamilyValue, encryptFamilyValue } from "@/server/family-crypto";

type Context = { params: Promise<{ id: string }> };

async function getFamilyScope(id: string, organizationId: string) {
  const [family] = await getDb().select({ id: families.id, organizationId: families.organizationId, centreId: families.centreId }).from(families).where(and(eq(families.id, id), eq(families.organizationId, organizationId))).limit(1);
  return family;
}

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("families.sharing.manage");
  if (access.response) return access.response;
  const family = await getFamilyScope(id, access.staff.organizationId);
  if (!family || !canAccessFamilyCentre(access.staff.grants, "families.sharing.manage", family.centreId) || !canAccessFamilyCentre(access.staff.grants, "patients.read", family.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const rows = await getDb().select({ id: familyAccessGrants.id, patientId: familyAccessGrants.patientId, granteePatientId: familyAccessGrants.granteePatientId, allowedData: familyAccessGrants.allowedData, purposeCiphertext: familyAccessGrants.purposeCiphertext, authorizationBasis: familyAccessGrants.authorizationBasis, status: familyAccessGrants.status, effectiveAt: familyAccessGrants.effectiveAt, expiresAt: familyAccessGrants.expiresAt, verifiedAt: familyAccessGrants.verifiedAt, revokedAt: familyAccessGrants.revokedAt, patientNumber: patients.patientNumber, patientCentreId:patients.centreId,encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext })
    .from(familyAccessGrants).innerJoin(patients, eq(patients.id, familyAccessGrants.patientId)).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId)))
    .where(and(eq(familyAccessGrants.organizationId, family.organizationId), eq(familyAccessGrants.familyId, family.id)));
  const mapped = await Promise.all(rows.map(async ({encryptionKeyId,nameCiphertext,patientCentreId,...grant}) => {
    const [grantee] = await getDb().select({ patientNumber: patients.patientNumber,centreId:patients.centreId,encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext }).from(patients).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId))).where(and(eq(patients.id, grant.granteePatientId), eq(patients.organizationId, family.organizationId),eq(patients.centreId,family.centreId))).limit(1);
    const identity=decryptPatientIdentity({encryptionKeyId,nameCiphertext},{organizationId:family.organizationId,centreId:patientCentreId,patientId:grant.patientId});
    const granteeIdentity=grantee?decryptPatientIdentity(grantee,{organizationId:family.organizationId,centreId:grantee.centreId,patientId:grant.granteePatientId}):null;
    const purpose = decryptFamilyValue("grant-purpose",grant.purposeCiphertext,{organizationId:family.organizationId,centreId:family.centreId,recordId:grant.id});
    return { ...grant, purpose, patientName: `${identity.firstName} ${identity.lastName}`, granteePatientNumber: grantee?.patientNumber ?? "", granteeName: granteeIdentity ? `${granteeIdentity.firstName} ${granteeIdentity.lastName}` : "" };
  }));
  return Response.json({ grants: mapped, canVerify: canAccessFamilyCentre(access.staff.grants, "families.sharing.verify", family.centreId) });
}

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = familyGrantCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const access = await getApiAccess("families.sharing.manage");
  if (access.response) return access.response;
  const family = await getFamilyScope(id, access.staff.organizationId);
  if (!family || !canAccessFamilyCentre(access.staff.grants, "families.sharing.manage", family.centreId) || !canAccessFamilyCentre(access.staff.grants, "patients.read", family.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const db = getDb();
  try {
    const grant = await db.transaction(async (tx) => {
      await tx.select({ id: families.id }).from(families).where(eq(families.id, id)).for("update");
      const activeMembers = await tx.select({ patientId: familyMembers.patientId }).from(familyMembers).where(and(eq(familyMembers.organizationId, family.organizationId), eq(familyMembers.familyId, family.id), inArray(familyMembers.status, ["ACTIVE"])));
      if (!activeMembers.some((member) => member.patientId === parsed.data.patientId) || !activeMembers.some((member) => member.patientId === parsed.data.granteePatientId)) throw new Error("family_membership_changed");
      const grantId = randomUUID();
      const [created] = await tx.insert(familyAccessGrants).values({ id: grantId, organizationId: family.organizationId, centreId: family.centreId, familyId: family.id, patientId: parsed.data.patientId, granteePatientId: parsed.data.granteePatientId, allowedData: parsed.data.allowedData, purposeCiphertext: encryptFamilyValue("grant-purpose",parsed.data.purpose,{organizationId:family.organizationId,centreId:family.centreId,recordId:grantId}), authorizationBasis: parsed.data.authorizationBasis, status: "PENDING_VERIFICATION", effectiveAt: parsed.data.effectiveAt ? new Date(parsed.data.effectiveAt) : new Date(), expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null, createdByStaffId: access.staff.staffUserId }).returning({ id: familyAccessGrants.id, status: familyAccessGrants.status });
      await appendAuditEvent(tx, { organizationId: family.organizationId, centreId: family.centreId, actorStaffId: access.staff.staffUserId, action: "family.sharing.requested", entityType: "family", entityId: family.id, details: { grantId: created.id, status: created.status } });
      return created;
    });
    return Response.json({ grant }, { status: 201 });
  } catch { return Response.json({ error: "sharing_request_conflict_or_unavailable" }, { status: 409 }); }
}
