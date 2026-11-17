import { AdminShell } from "@/components/admin/admin-shell";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";
import { SamplesDirectory } from "@/components/samples/sample-workbench";

export default function RecollectionPage() { return <AdminShell permission="samples.read" title="Sample rejection & recollection queue">{(staff) => <><SampleWorkflowNav current="L010"/><section className="admin-card"><p>Review open sample exceptions and authorized recollection states. Customer notification is not sent here; collection jobs require their own confirmed appointment/order and an authorized assignment.</p></section><SamplesDirectory mode="exceptions" grants={staff.grants}/></>}</AdminShell>; }
