import { AdminShell } from "@/components/admin/admin-shell";
import { RolePermissionManager } from "@/components/admin/role-permission-manager";

export default function AdminAccessPage() {
  return <AdminShell permission="roles.read" title="Roles and fine-grained permissions">{(staff) => <>
    <p className="admin-card">S003 · Permission changes are enforced by protected APIs. Only the owner with an unscoped roles.manage grant can change role definitions; assignments retain separate scope and audit controls.</p>
    <RolePermissionManager canManage={staff.isOwner && staff.grants.some((grant) => grant.key === "roles.manage" && grant.centreId === null)} />
  </>}</AdminShell>;
}
