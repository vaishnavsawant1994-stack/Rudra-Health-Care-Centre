import { AdminShell } from "@/components/admin/admin-shell";
import { Phase08CapabilityBoundary, Phase08RouteNavigation } from "@/components/communications/phase08-route-support";

export default function AIQualityReviewPage() {
  return <AdminShell permission="configuration.read" title="AI conversation quality review">{() => <>
    <Phase08RouteNavigation current="A009" />
    <Phase08CapabilityBoundary title="No AI conversations are available for review" state="Evaluation pipeline not connected">
      <p>The public service guide is deterministic and does not save conversations. No deployed model transcripts, tool-use logs, model evaluations or real AI quality scores exist in this environment.</p>
      <p>Unsafe-response review, redaction, reviewer decisions and corrective actions remain unavailable until an authorized model and transcript governance pipeline are approved.</p>
    </Phase08CapabilityBoundary>
  </>}</AdminShell>;
}
