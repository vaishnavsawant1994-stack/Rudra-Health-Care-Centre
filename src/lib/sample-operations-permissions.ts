import type { PermissionGrant } from "@/server/permissions";

function hasAtCentre(grants: readonly PermissionGrant[], key: string, centreId: string) {
  return grants.some((grant) => grant.key === key && (grant.centreId === null || grant.centreId === centreId));
}

export function mayCreateCollectionJobAtCentre(grants: readonly PermissionGrant[], centreId: string) {
  return hasAtCentre(grants, "collections.assign", centreId);
}

export function mayManageProceduresAtCentre(grants: readonly PermissionGrant[], centreId: string) {
  return hasAtCentre(grants, "samples.procedures.manage", centreId);
}

export function mayReceiveSamplesAtCentre(grants: readonly PermissionGrant[], centreId: string) {
  return hasAtCentre(grants, "samples.receive", centreId);
}

export function mayManageSampleExceptionsAtCentre(grants: readonly PermissionGrant[], centreId: string) {
  return hasAtCentre(grants, "samples.exceptions.manage", centreId);
}

export function mayAuthorizeRecollectionAtCentre(grants: readonly PermissionGrant[], centreId: string) {
  return hasAtCentre(grants, "samples.recollection.authorize", centreId);
}

export function mayDispatchSamplesAtCentre(grants: readonly PermissionGrant[], centreId: string) {
  return hasAtCentre(grants, "samples.dispatch", centreId);
}

export function mayVerifyExternalReceiptAtCentre(grants: readonly PermissionGrant[], centreId: string) {
  return hasAtCentre(grants, "samples.external.verify", centreId);
}

export function mayRecordVisitAtCentre(grants: readonly PermissionGrant[], centreId: string, assignedStaffId: string | null, staffId: string) {
  return hasAtCentre(grants, "collections.visit.record", centreId)
    && (assignedStaffId === staffId || mayCreateCollectionJobAtCentre(grants, centreId));
}

export function mayCollectSampleAtCentre(grants: readonly PermissionGrant[], centreId: string, assignedStaffId: string | null, staffId: string) {
  return hasAtCentre(grants, "samples.collect", centreId)
    && (assignedStaffId === staffId || mayCreateCollectionJobAtCentre(grants, centreId));
}
