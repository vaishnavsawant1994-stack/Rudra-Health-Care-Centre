import { AdminShell } from "@/components/admin/admin-shell";
import { Phase08CapabilityBoundary, Phase08RouteNavigation, ProviderDisabledNotice } from "@/components/communications/phase08-route-support";
import { CommunicationGovernanceWorkbench } from "@/components/communications/communication-governance-workbench";

export default function VoiceConfigurationPage() {
  return <AdminShell permission="configuration.manage" title="AI calling and receptionist configuration">{(staff) => <>
    <Phase08RouteNavigation current="A003" />
    <ProviderDisabledNotice provider="voice" />
    <Phase08CapabilityBoundary title="Voice safety policy" state="Not approved for activation">
      <p>Number routing, language scripts, call recording, automated answering and outbound calls are unavailable until provider authorization, consent, lawful recording, retention, access and escalation policies are qualified.</p>
    </Phase08CapabilityBoundary>
    <CommunicationGovernanceWorkbench kind="PROVIDER_POLICY" channel="VOICE" canManage={staff.grants.some((grant) => grant.key === "configuration.manage")} />
  </>}</AdminShell>;
}
