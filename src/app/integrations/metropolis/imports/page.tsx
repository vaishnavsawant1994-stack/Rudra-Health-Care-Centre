import { AdminShell } from "@/components/admin/admin-shell";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";
import { MetropolisWorkbench } from "@/components/samples/metropolis-workbench";

export default function MetropolisImportsPage() { return <AdminShell permission="samples.read" title="Metropolis import & validation review">{(staff) => <><SampleWorkflowNav current="L012"/><MetropolisWorkbench mode="imports" grants={staff.grants} staffId={staff.staffUserId}/></>}</AdminShell>; }
