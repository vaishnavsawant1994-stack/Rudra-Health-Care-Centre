import { AdminShell } from "@/components/admin/admin-shell";
import { CampaignWorkbench } from "@/components/marketing/campaign-workbench";
import { Phase08CapabilityBoundary, Phase08RouteNavigation } from "@/components/communications/phase08-route-support";

export default function OutboundCommunicationsPage() {
  return <AdminShell permission="marketing.read" title="Outbound communication preparation">{(staff) => <>
    <Phase08RouteNavigation current="A010" />
    <Phase08CapabilityBoundary title="External audience delivery is disabled" state="No send or schedule action">
      <p>The campaign records below are internal attribution records, not outbound message campaigns. They do not select recipients, bypass consent, suppress opt-outs or send communications.</p>
      <p>Provider authorization, approved message templates, channel consent, quiet hours and duplicate suppression are required before any audience contact.</p>
    </Phase08CapabilityBoundary>
    <CampaignWorkbench managedCentreIds={staff.grants.filter((grant) => grant.key === "marketing.manage").map((grant) => grant.centreId ?? "*")} />
  </>}</AdminShell>;
}
