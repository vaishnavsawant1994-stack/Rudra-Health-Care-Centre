import { AdminShell } from "@/components/admin/admin-shell";
import { AssignmentManager } from "@/components/admin/assignment-manager";
export default async function AssignmentsPage() { return <AdminShell permission="assignments.read" title="Staff role assignment">{(staff) => <AssignmentManager manageScopes={staff.grants.filter((grant) => grant.key === "assignments.manage").map((grant) => grant.centreId)} />}</AdminShell>; }
