import { AdminShell } from "@/components/admin/admin-shell";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";
import { MetropolisWorkbench } from "@/components/samples/metropolis-workbench";

export default function MetropolisLinksPage() { return <AdminShell permission="samples.read" title="Metropolis reference mappings">{(staff) => <><SampleWorkflowNav current="L008"/><MetropolisWorkbench mode="references" grants={staff.grants} staffId={staff.staffUserId}/></>}</AdminShell>; }
