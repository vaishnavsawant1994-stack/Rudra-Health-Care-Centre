import { AdminShell } from "@/components/admin/admin-shell";
import { PublicEnquiryReview } from "@/components/leads/public-enquiry-workbench";

export default function PublicEnquiriesPage() {
  return <AdminShell permission="leads.read" title="Website enquiries">{(staff) => {
    const has = (permission: string) => staff.grants.some((grant) => grant.key === permission);
    const taskGrants = staff.grants.filter((grant) => ["tasks.create", "tasks.support.create", "tasks.read", "tasks.assigned.read", "tasks.support.read"].includes(grant.key));
    const relationshipGrants = staff.grants.filter((grant) => ["corporate.manage", "partners.manage"].includes(grant.key));
    return <PublicEnquiryReview staffId={staff.staffUserId} canCreate={has("leads.create")} canAssign={has("leads.assign")} canDismiss={has("leads.update")} taskGrants={taskGrants} relationshipGrants={relationshipGrants} />;
  }}</AdminShell>;
}
