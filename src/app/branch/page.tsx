import { AdminShell } from "@/components/admin/admin-shell";
import { CentreOperationsSummary } from "@/components/branch/centre-operations-summary";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";

export default function BranchOperationsPage() {
  return <AdminShell permission="workspace.read" title="Branch operations overview"><><SampleWorkflowNav current="L001"/><section className="admin-card"><p className="eyebrow">Branch & diagnostic operations</p><h2>Centre-scoped workload</h2><p>Receipts, dispatch, open exceptions and report tasks come from staff-authorized operational queues. A dispatch record does not establish external laboratory receipt.</p></section><CentreOperationsSummary/></></AdminShell>;
}
