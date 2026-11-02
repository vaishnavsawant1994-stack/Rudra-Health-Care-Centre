import definitions from "./permission-catalog.json";

export const permissionCatalog = definitions.permissions as unknown as readonly (readonly [string, string, "ORGANIZATION" | "CENTRE"])[];
export const roleCatalog = definitions.roles as unknown as readonly (readonly [string, string, "ORGANIZATION" | "CENTRE"])[];
export const defaultRoleGrants: Record<string, string[]> = definitions.roleGrants;

export type PermissionKey = (typeof permissionCatalog)[number][0];
export type PermissionGrant = { key: string; centreId: string | null };

export function hasPermission(grants: PermissionGrant[], permission: PermissionKey, centreId?: string) {
  return grants.some((grant) => grant.key === permission && (
    centreId ? grant.centreId === null || grant.centreId === centreId : true
  ));
}

export function isRoleChangeAllowed(actor: { isOwner: boolean; permissions: string[] }, target: { isOwner: boolean }, requestedPermissionKeys: string[]) {
  if (target.isOwner && !actor.isOwner) return false;
  if (!actor.isOwner && !actor.permissions.includes("assignments.manage")) return false;
  if (requestedPermissionKeys.some((key) => !actor.permissions.includes(key)) && !actor.isOwner) return false;
  return true;
}
