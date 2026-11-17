import { AdminShell } from "@/components/admin/admin-shell";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";
import { MetropolisWorkbench } from "@/components/samples/metropolis-workbench";

export default function AdminIntegrationEventsPage() {
  return <AdminShell permission="samples.read" title="Integration events and failure review">{(staff) => <>
    <SampleWorkflowNav current="L009" />
    <section className="admin-card"><p className="eyebrow">S007 · Staff-recorded evidence only</p><p>The workbench shows manually recorded Metropolis status evidence and review history. No provider event feed, failure queue, retry execution or external synchronization is connected.</p></section>
    <MetropolisWorkbench mode="status" grants={staff.grants} staffId={staff.staffUserId} />
  </>}</AdminShell>;
}
