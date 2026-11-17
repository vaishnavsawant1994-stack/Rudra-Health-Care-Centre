import { AdminShell } from "@/components/admin/admin-shell";
import { CommunicationTemplateWorkbench } from "@/components/communications/communication-template-workbench";
import { Phase08CapabilityBoundary, Phase08RouteNavigation } from "@/components/communications/phase08-route-support";

export default function NotificationTemplatePage() {
  return <AdminShell permission="leads.followups.manage" title="Notification template governance">{() => <>
    <Phase08RouteNavigation current="A013" />
    <Phase08CapabilityBoundary title="Versioned internal templates" state="Delivery disabled">
      <p>Templates are encrypted, versioned and audited. Internal activation does not send or queue a notification. No delivery event may be marked sent without provider evidence.</p>
      <p>Current templates support PHONE, EMAIL and WHATSAPP copy. SMS, notification delivery logs, recipient verification, channel preference checks and provider retries are not connected here.</p>
    </Phase08CapabilityBoundary>
    <CommunicationTemplateWorkbench />
  </>}</AdminShell>;
}
