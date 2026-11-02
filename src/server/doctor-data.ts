import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";

export type DoctorPrivateData = { name: string; phone: string | null; email: string | null; registrationReference: string | null; affiliation: string | null; notes: string | null };
export function sealDoctorData(scope: { organizationId: string; centreId: string; id: string }, value: DoctorPrivateData) {
  return encryptOperationalData(value, operationalContext({ organizationId: scope.organizationId, centreId: scope.centreId, recordId: scope.id }, "doctor-profile"));
}
export function openDoctorData(scope: { organizationId: string; centreId: string; id: string }, ciphertext: string): DoctorPrivateData {
  return decryptOperationalData<DoctorPrivateData>(ciphertext, operationalContext({ organizationId: scope.organizationId, centreId: scope.centreId, recordId: scope.id }, "doctor-profile"));
}
export function sealDoctorEvent(scope: { organizationId: string; centreId: string; id: string }, value: Record<string, unknown>) {
  return encryptOperationalData(value, operationalContext({ organizationId: scope.organizationId, centreId: scope.centreId, recordId: scope.id }, "doctor-relationship-event"));
}
export function openDoctorEvent(scope: { organizationId: string; centreId: string; id: string }, ciphertext: string) {
  return decryptOperationalData<Record<string, unknown>>(ciphertext, operationalContext({ organizationId: scope.organizationId, centreId: scope.centreId, recordId: scope.id }, "doctor-relationship-event"));
}
