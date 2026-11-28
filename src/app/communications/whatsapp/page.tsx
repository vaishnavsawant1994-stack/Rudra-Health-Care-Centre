import { AdminShell } from "@/components/admin/admin-shell";
import { Phase08CapabilityBoundary, Phase08RouteNavigation, ProviderDisabledNotice } from "@/components/communications/phase08-route-support";
import { CommunicationGovernanceWorkbench } from "@/components/communications/communication-governance-workbench";

export default function WhatsAppConfigurationPage() {
  return <AdminShell permission="configuration.manage" title="WhatsApp automation configuration">{(staff) => <>
    <Phase08RouteNavigation current="A002" />
    <ProviderDisabledNotice provider="WhatsApp" />
    <Phase08CapabilityBoundary title="Permitted internal preparation" state="Governance only">
      <p>Versioned communication templates can be prepared and reviewed internally. A template's internal activation is not provider approval or permission to deliver.</p>
      <a className="button-link" href="/communications/notifications">Open notification template governance</a>
    </Phase08CapabilityBoundary>
    <CommunicationGovernanceWorkbench kind="PROVIDER_POLICY" channel="WHATSAPP" canManage={staff.grants.some((grant) => grant.key === "configuration.manage")} />
  </>}</AdminShell>;
}
