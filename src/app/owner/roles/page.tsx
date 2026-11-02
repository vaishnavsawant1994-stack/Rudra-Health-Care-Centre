import { AdminShell } from "@/components/admin/admin-shell";
import { RolePermissionManager } from "@/components/admin/role-permission-manager";
export default async function RolesPage() { return <AdminShell permission="roles.read" title="Roles & permissions">{(staff) => <RolePermissionManager canManage={staff.isOwner && staff.grants.some((grant) => grant.key === "roles.manage" && grant.centreId === null)} />}</AdminShell>; }
