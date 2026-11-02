import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { familyMembers, families, patientContactSecrets, patients } from "@/db/schema";
import type { StaffContext } from "@/server/access";
import { canAccessFamilyCentre, visibleFamilyCentres } from "@/server/family-policy";
import { decryptPatientIdentity } from "@/server/patient-contact-crypto";
import { blindIndexFamilyName, decryptFamilyValue } from "@/server/family-crypto";

export async function searchAuthorizedFamilies(staff: StaffContext, rawQuery: string, centreId: string | null) {
  if (rawQuery.length > 80 || rawQuery.trim().length === 1) return Response.json({ error: "invalid_search" }, { status: 400 });
  const familyCentres = visibleFamilyCentres(staff.grants, "families.read");
  const patientCentres = visibleFamilyCentres(staff.grants, "patients.read");
  if (centreId && (!canAccessFamilyCentre(staff.grants, "families.read", centreId) || !canAccessFamilyCentre(staff.grants, "patients.read", centreId))) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!centreId && familyCentres !== null && !familyCentres.length) return Response.json({ families: [] });
  if (!centreId && patientCentres !== null && !patientCentres.length) return Response.json({ families: [] });
  let allowedCentres: string[] | null = null;
  if (familyCentres !== null && patientCentres !== null) allowedCentres = familyCentres.filter((id) => patientCentres.includes(id));
  else if (familyCentres !== null) allowedCentres = familyCentres;
  else if (patientCentres !== null) allowedCentres = patientCentres;
  if (allowedCentres !== null && allowedCentres.length === 0) return Response.json({ families: [] });

  const conditions = [eq(families.organizationId, staff.organizationId)];
  if (centreId) conditions.push(eq(families.centreId, centreId));
  else if (allowedCentres !== null) conditions.push(inArray(families.centreId, allowedCentres));
  if (rawQuery.trim()) {
    const term = `%${rawQuery.trim().replace(/[\\%_]/g, "\\$&")}%`;
    conditions.push(or(eq(families.displayNameBlindIndex, blindIndexFamilyName(rawQuery)), ilike(families.familyNumber, term))!);
  }
  const rows = await getDb().select({
    id: families.id, familyNumber: families.familyNumber, displayNameCiphertext: families.displayNameCiphertext,
    centreId: families.centreId, primaryContactPatientId: families.primaryContactPatientId,
    createdAt: families.createdAt,
  }).from(families).where(and(...conditions)).orderBy(desc(families.createdAt)).limit(50);
  if (!rows.length) return Response.json({ families: [] });
  const ids = rows.map((row) => row.id);
  const memberships = await getDb().select({ familyId: familyMembers.familyId, status: familyMembers.status, patientId: patients.id, patientCentreId:patients.centreId,encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext })
    .from(familyMembers).innerJoin(patients, eq(patients.id, familyMembers.patientId)).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId)))
    .where(and(eq(familyMembers.organizationId, staff.organizationId), inArray(familyMembers.familyId, ids)));
  const names=memberships.map(({encryptionKeyId,nameCiphertext,patientCentreId,...member})=>({...member,...decryptPatientIdentity({encryptionKeyId,nameCiphertext},{organizationId:staff.organizationId,centreId:patientCentreId,patientId:member.patientId})}));
  const summaries = rows.map(({displayNameCiphertext,...family}) => {
    const displayName = decryptFamilyValue("display-name", displayNameCiphertext, {organizationId:staff.organizationId,centreId:family.centreId,recordId:family.id});
    const members = names.filter((member) => member.familyId === family.id);
    const primary = members.find((member) => member.patientId === family.primaryContactPatientId && member.status === "ACTIVE");
    return { ...family, displayName, activeMemberCount: members.filter((member) => member.status === "ACTIVE").length, pendingMemberCount: members.filter((member) => member.status === "PENDING_VERIFICATION").length, primaryContactName: primary ? `${primary.firstName} ${primary.lastName}` : null };
  });
  return Response.json({ families: summaries });
}
