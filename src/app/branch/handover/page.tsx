import { AdminShell } from "@/components/admin/admin-shell";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";
import { DispatchBatchQueue } from "@/components/samples/dispatch-batch-queue";

export default function BranchCourierHandoverPage() { return <AdminShell permission="samples.read" title="Driver & courier handover">{(staff) => <><SampleWorkflowNav current="L006"/><DispatchBatchQueue mode="handover" grants={staff.grants}/></>}</AdminShell>; }
