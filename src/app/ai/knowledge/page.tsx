import { AdminShell } from "@/components/admin/admin-shell";
import { Phase08CapabilityBoundary, Phase08RouteNavigation } from "@/components/communications/phase08-route-support";
import { CommunicationGovernanceWorkbench } from "@/components/communications/communication-governance-workbench";

export default function KnowledgeLibraryPage() {
  return <AdminShell permission="configuration.manage" title="AI knowledge library">{(staff) => <>
    <Phase08RouteNavigation current="A008" />
    <Phase08CapabilityBoundary title="Knowledge publication is unavailable" state="No approved AI knowledge lifecycle">
      <p>Encrypted, versioned draft records can now be prepared. Review, approval, expiry processing, withdrawal and use by an assistant are not implemented.</p>
      <p>Clinical material remains a draft only until qualified clinical review, source provenance and an authorized approval workflow are implemented.</p>
      <a className="button-link" href="/owner/website-content">Open website content governance</a>
    </Phase08CapabilityBoundary>
    <CommunicationGovernanceWorkbench kind="KNOWLEDGE" canManage={staff.grants.some((grant) => grant.key === "configuration.manage")} />
  </>}</AdminShell>;
}
