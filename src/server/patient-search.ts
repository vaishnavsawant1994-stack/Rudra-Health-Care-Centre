import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { patientContactSecrets, patients } from "@/db/schema";
import type { StaffContext } from "@/server/access";
import { canAccessPatientCentre, normalizePatientSearch, visiblePatientCentres } from "@/server/patient-policy";
import { blindIndexPatientContact, blindIndexPatientName, decryptPatientContacts, decryptPatientIdentity } from "@/server/patient-contact-crypto";

export async function searchAuthorizedPatients(staff: StaffContext, rawSearch: string, requestedCentre: string | null) {
  if (rawSearch.length > 80 || (rawSearch.trim().length === 1)) return Response.json({ error: "invalid_search" }, { status: 400 });
  const centresVisible = visiblePatientCentres(staff.grants, "patients.read");
  if (requestedCentre && !canAccessPatientCentre(staff.grants, "patients.read", requestedCentre)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!requestedCentre && centresVisible !== null && centresVisible.length === 0) return Response.json({ patients: [] });
  const search = normalizePatientSearch(rawSearch);
  const conditions = [eq(patients.organizationId, staff.organizationId)];
  if (requestedCentre) conditions.push(eq(patients.centreId, requestedCentre));
  else if (centresVisible !== null) conditions.push(inArray(patients.centreId, centresVisible));
  if (search) {
    const term = `%${search}%`;
    const digits=rawSearch.replace(/\D/g,"");const phoneIndex=digits.length>=7&&digits.length<=15&&/^[+0-9 ()-]+$/.test(rawSearch)?blindIndexPatientContact("phone",rawSearch):null;
    const nameTerm=rawSearch.trim();
    const nameIndexes=[blindIndexPatientName("first",nameTerm),blindIndexPatientName("last",nameTerm),blindIndexPatientName("full",nameTerm)];
    conditions.push(or(ilike(patients.patientNumber, term),phoneIndex?eq(patientContactSecrets.phoneBlindIndex,phoneIndex):undefined,eq(patientContactSecrets.firstNameBlindIndex,nameIndexes[0]),eq(patientContactSecrets.lastNameBlindIndex,nameIndexes[1]),eq(patientContactSecrets.fullNameBlindIndex,nameIndexes[2]))!);
  }
  const rows = await getDb().select({
    id: patients.id, patientNumber: patients.patientNumber,
    encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext,profileCiphertext:patientContactSecrets.profileCiphertext,phoneCiphertext:patientContactSecrets.phoneCiphertext,emailCiphertext:patientContactSecrets.emailCiphertext,centreId: patients.centreId,
    createdAt: patients.createdAt,
  }).from(patients).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId))).where(and(...conditions)).orderBy(desc(patients.createdAt)).limit(50);
  return Response.json({ patients: rows.map(({encryptionKeyId,nameCiphertext,profileCiphertext,phoneCiphertext,emailCiphertext,...row})=>{const context={organizationId:staff.organizationId,centreId:row.centreId,patientId:row.id};const identity=decryptPatientIdentity({encryptionKeyId,nameCiphertext},context);return {...row,...identity,preferredName:decryptPatientContacts({encryptionKeyId,profileCiphertext,phoneCiphertext,emailCiphertext},{organizationId:staff.organizationId,centreId:row.centreId,patientId:row.id}).profile.preferredName};}) });
}
