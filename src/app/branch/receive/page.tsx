import { AdminShell } from "@/components/admin/admin-shell";
import { SamplesDirectory } from "@/components/samples/sample-workbench";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";

export default function BranchReceivePage() { return <AdminShell permission="samples.receive" title="Branch sample receiving">{(staff) => <><SampleWorkflowNav current="L003"/><section className="admin-card"><p>Collector submission and physical branch receipt are separate. Receiving requires the submitted specimen, an approved centre receiving procedure and the authorized receiving action.</p></section><SamplesDirectory mode="receiving" grants={staff.grants}/></>}</AdminShell>; }
