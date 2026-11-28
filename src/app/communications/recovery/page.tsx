import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { Phase08CapabilityBoundary, Phase08RouteNavigation } from "@/components/communications/phase08-route-support";
import { SupportTicketQueue } from "@/components/support/support-ticket-queue";

export default function ContactRecoveryPage() {
  return <AdminShell permission="tasks.support.read" title="Contact recovery and callbacks">{() => <>
    <Phase08RouteNavigation current="A012" />
    <Phase08CapabilityBoundary title="Provider failure queues are unavailable" state="No synthetic misses shown as real events">
      <p>No missed-call, abandoned-chat or failed-delivery provider events are imported. The queue below contains only actual internal support tasks; it does not schedule callbacks or retry messages.</p>
      <p>Use recorded CRM follow-ups only when the contact policy permits outreach. Duplicate follow-up prevention and provider retry are not implemented by this screen.</p>
      <p><Link href="/leads/followups">Open authorized CRM follow-ups</Link></p>
    </Phase08CapabilityBoundary>
    <SupportTicketQueue />
  </>}</AdminShell>;
}
