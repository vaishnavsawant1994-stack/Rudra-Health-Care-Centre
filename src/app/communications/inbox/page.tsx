import { AdminShell } from "@/components/admin/admin-shell";
import { CommunicationTemplateWorkbench } from "@/components/communications/communication-template-workbench";
import { UnifiedCommunicationInbox } from "@/components/leads/communication-draft-queue";
import { Phase08CapabilityBoundary, Phase08RouteNavigation } from "@/components/communications/phase08-route-support";

export default function UnifiedInboxPage() {
  return <AdminShell permission="workspace.read" title="Unified communications inbox">{(staff) => <>
    <Phase08RouteNavigation current="A004" />
    <Phase08CapabilityBoundary title="Recorded enquiry and communication work" state="Internal records only">
      <p>This workspace shows authorized public enquiry metadata, centre-scoped unsent CRM drafts, and permitted follow-ups. It does not import external conversations or show clinical records based on contact linkage.</p>
      <p>Draft, attempted, queued and provider-confirmed delivery are separate states. No external provider is connected; this workspace does not send messages.</p>
    </Phase08CapabilityBoundary>
    {staff.grants.some((grant) => grant.key === "leads.followups.manage") && <CommunicationTemplateWorkbench />}
    {staff.grants.some((grant) => grant.key === "leads.read") ? <UnifiedCommunicationInbox canReadFollowups={staff.grants.some((grant) => grant.key === "leads.followups.manage")} /> : <p role="status">The CRM inbox requires separate lead-read permission. Template access does not expose lead records.</p>}
  </>}</AdminShell>;
}
