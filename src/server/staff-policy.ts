import type { PermissionKey } from "./permissions";
import type { StaffContext } from "./access";

export function hasOrganizationPermission(staff: StaffContext, key: PermissionKey) {
  return staff.grants.some((grant) => grant.key === key && grant.centreId === null);
}

export function permissionKeysAtScope(staff: StaffContext, centreId: string | null) {
  return staff.grants.filter((grant) => grant.centreId === null || (centreId !== null && grant.centreId === centreId)).map((grant) => grant.key);
}
