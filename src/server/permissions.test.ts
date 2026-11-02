import { describe, expect, it } from "vitest";
import { defaultRoleGrants, hasPermission, isRoleChangeAllowed, type PermissionGrant } from "./permissions";
import { permissionKeysAtScope } from "./staff-policy";

describe("server permission decisions", () => {
  it("enforces centre assignments and organization-wide grants", () => {
    const grants: PermissionGrant[] = [{ key: "staff.read", centreId: "centre-a" }];
    expect(hasPermission(grants, "staff.read", "centre-a")).toBe(true);
    expect(hasPermission(grants, "staff.read", "centre-b")).toBe(false);
    expect(hasPermission(grants, "staff.read")).toBe(true);
    expect(hasPermission([{ key: "staff.read", centreId: null }], "staff.read", "centre-b")).toBe(true);
  });
  it("prevents delegated administrators changing owner or privilege architecture", () => {
    const actor = { isOwner: false, permissions: ["assignments.manage"] };
    expect(isRoleChangeAllowed(actor, { isOwner: true }, ["workspace.read"])).toBe(false);
    expect(isRoleChangeAllowed(actor, { isOwner: false }, ["organization.manage"])).toBe(false);
    expect(isRoleChangeAllowed({ isOwner: true, permissions: [] }, { isOwner: false }, ["organization.manage"])).toBe(true);
  });
  it("limits delegated grant checks to the exact centre scope", () => {
    const staff = { staffUserId: "s", authUserId: "a", organizationId: "o", staffCode: "1", displayName: "Synthetic", isOwner: false, grants: [{ key: "assignments.manage", centreId: "centre-a" }, { key: "staff.read", centreId: "centre-a" }, { key: "staff.manage", centreId: "centre-b" }] };
    expect(permissionKeysAtScope(staff, "centre-a")).toContain("staff.read");
    expect(permissionKeysAtScope(staff, "centre-a")).not.toContain("staff.manage");
    expect(permissionKeysAtScope(staff, null)).toEqual([]);
  });
  it("includes the new relationship permissions only in intended default role grants", () => {
    for (const key of ["corporate.read", "corporate.manage", "partners.read", "partners.manage"]) {
      expect(defaultRoleGrants.sales_marketing).toContain(key);
      expect(defaultRoleGrants.centre_manager).toContain(key);
      expect(defaultRoleGrants.owner_super_admin).toContain(key);
    }
    expect(defaultRoleGrants.receptionist).not.toContain("corporate.read");
    expect(defaultRoleGrants.receptionist).not.toContain("partners.read");
  });
});
