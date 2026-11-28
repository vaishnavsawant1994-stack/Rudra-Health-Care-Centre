import { AdminShell } from "@/components/admin/admin-shell";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";
import { DispatchBatchQueue } from "@/components/samples/dispatch-batch-queue";

export default function BranchTransitPage() { return <AdminShell permission="samples.read" title="In-transit shipment evidence">{(staff) => <><SampleWorkflowNav current="L007"/><DispatchBatchQueue mode="transit" grants={staff.grants}/></>}</AdminShell>; }
