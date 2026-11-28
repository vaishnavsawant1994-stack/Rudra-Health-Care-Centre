import { AdminShell } from "@/components/admin/admin-shell";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";
import { MetropolisWorkbench } from "@/components/samples/metropolis-workbench";

export default function MetropolisStatusPage() { return <AdminShell permission="samples.read" title="Manual Metropolis status evidence">{(staff) => <><SampleWorkflowNav current="L009"/><MetropolisWorkbench mode="status" grants={staff.grants} staffId={staff.staffUserId}/></>}</AdminShell>; }
