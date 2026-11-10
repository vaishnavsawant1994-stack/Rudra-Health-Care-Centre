import { AdminShell } from "@/components/admin/admin-shell";
import { UnifiedCommunicationInbox } from "@/components/leads/communication-draft-queue";
import { CommunicationTemplateWorkbench } from "@/components/communications/communication-template-workbench";
import { ReceptionWorkflowNav } from "@/components/appointments/reception-workflow-nav";

export default function CommunicationsPage() {
  return <AdminShell permission="workspace.read" title="Communications inbox">{(staff) => <><ReceptionWorkflowNav current="11" />
    {staff.grants.some((grant) => grant.key === "leads.followups.manage") && <CommunicationTemplateWorkbench />}
    {staff.grants.some((grant) => grant.key === "leads.read") ? <UnifiedCommunicationInbox canReadFollowups={staff.grants.some((grant) => grant.key === "leads.followups.manage")} /> : <p role="status">The inbox requires separate lead-read permission. Template management access does not expose lead records.</p>}
    {!staff.grants.some((grant) => grant.key === "leads.followups.manage" || grant.key === "leads.read") && <p role="status">No communications workflow is permitted for this account.</p>}
  </>}</AdminShell>;
}
