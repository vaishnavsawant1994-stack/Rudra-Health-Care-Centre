import { AdminShell } from "@/components/admin/admin-shell";
import { StaffProfilePanel } from "@/components/admin/staff-profile-panel";
export const instant = false;
export default async function StaffProfilePage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <AdminShell permission="staff.read" title="Staff profile">{(staff) => <StaffProfilePanel staffId={id} canManage={staff.grants.some((grant) => grant.key === "staff.manage" && grant.centreId === null)} />}</AdminShell>; }
