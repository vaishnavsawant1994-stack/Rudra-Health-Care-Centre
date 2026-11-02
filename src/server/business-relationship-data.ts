import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";

export type BusinessRelationshipType = "CORPORATE" | "PARTNER";
export type BusinessRelationshipPrivateData = {
  name: string; legalName: string | null; primaryContactName: string | null; primaryContactRole: string | null;
  phone: string | null; email: string | null; address: string | null; agreementReference: string | null;
  agreementStatus: "NOT_RECORDED" | "PENDING_REVIEW"; notes: string | null;
};

function context(scope: { organizationId: string; centreId: string; id: string }, type: BusinessRelationshipType, event = false) {
  return operationalContext({ organizationId: scope.organizationId, centreId: scope.centreId, recordId: scope.id }, `business-relationship-${type.toLowerCase()}${event ? "-event" : ""}`);
}

export function sealBusinessRelationship(scope: { organizationId: string; centreId: string; id: string }, type: BusinessRelationshipType, value: BusinessRelationshipPrivateData) {
  return encryptOperationalData(value, context(scope, type));
}
export function openBusinessRelationship(scope: { organizationId: string; centreId: string; id: string }, type: BusinessRelationshipType, ciphertext: string) {
  return decryptOperationalData<BusinessRelationshipPrivateData>(ciphertext, context(scope, type));
}
export function sealBusinessRelationshipEvent(scope: { organizationId: string; centreId: string; id: string }, type: BusinessRelationshipType, value: Record<string, unknown>) {
  return encryptOperationalData(value, context(scope, type, true));
}
export function openBusinessRelationshipEvent(scope: { organizationId: string; centreId: string; id: string }, type: BusinessRelationshipType, ciphertext: string) {
  return decryptOperationalData<Record<string, unknown>>(ciphertext, context(scope, type, true));
}
