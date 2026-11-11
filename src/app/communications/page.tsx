import { AdminShell } from "@/components/admin/admin-shell";
import { UnifiedCommunicationInbox } from "@/components/leads/communication-draft-queue";
import { CommunicationTemplateWorkbench } from "@/components/communications/communication-template-workbench";
import { ReceptionWorkflowNav } from "@/components/appointments/reception-workflow-nav";
import Link from "next/link";

export default function CommunicationsPage() {
  return <AdminShell permission="workspace.read" title="Communications inbox">{(staff) => <><ReceptionWorkflowNav current="11" />
    <section className="admin-card" aria-labelledby="communications-design-preview-title">
      <h2 id="communications-design-preview-title">Communications & AI screen designs</h2>
      <p>Open the A001–A013 visual reference workspace. It uses synthetic examples only; no messages or calls are sent.</p>
      <Link className="button-link" href="/communications/design/a001">Open A001–A013 design preview →</Link>
    </section>
    {staff.grants.some((grant) => grant.key === "leads.followups.manage") && <CommunicationTemplateWorkbench />}
    {staff.grants.some((grant) => grant.key === "leads.read") ? <UnifiedCommunicationInbox canReadFollowups={staff.grants.some((grant) => grant.key === "leads.followups.manage")} /> : <p role="status">The inbox requires separate lead-read permission. Template management access does not expose lead records.</p>}
    {!staff.grants.some((grant) => grant.key === "leads.followups.manage" || grant.key === "leads.read") && <p role="status">No communications workflow is permitted for this account.</p>}
  </>}</AdminShell>;
}
