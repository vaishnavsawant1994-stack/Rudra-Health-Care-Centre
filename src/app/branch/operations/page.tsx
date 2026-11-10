import { AdminShell } from "@/components/admin/admin-shell";
import { CentreOperationsSummary } from "@/components/branch/centre-operations-summary";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";

export default function CentreOperationsPage() {
  return <AdminShell permission="workspace.read" title="Centre operations"><>
    <section className="admin-card"><p className="eyebrow">Operational overview</p><h2>Work queues at a glance</h2><p>Only counts for centres and workflows covered by your active permissions are shown. Each work queue checks access again before displaying records or accepting actions.</p></section>
    <SampleWorkflowNav current="L001" />
    <CentreOperationsSummary />
  </></AdminShell>;
}
