import { AdminShell } from "@/components/admin/admin-shell";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";
import { SamplesDirectory } from "@/components/samples/sample-workbench";

export default function BranchSamplesPage() { return <AdminShell permission="samples.read" title="Branch sample queue">{(staff) => <><SampleWorkflowNav current="L002"/><section className="admin-card"><p>Search Rudra specimen identifiers and review their recorded custody. Physical barcode scanning is unavailable until label format and hardware behavior are approved; text lookup is not represented as a scan.</p></section><SamplesDirectory grants={staff.grants}/></>}</AdminShell>; }
