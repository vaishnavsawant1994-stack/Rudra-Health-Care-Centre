import { AdminShell } from "@/components/admin/admin-shell";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";
import { SamplesDirectory } from "@/components/samples/sample-workbench";

export default function BranchQualityCheckPage() { return <AdminShell permission="samples.read" title="Sample condition & exception review">{(staff) => <><SampleWorkflowNav current="L004"/><section className="admin-card"><p className="setup-notice">Quality exceptions are recorded with restricted staff access, reasons and audit history. Clinical condition checklists, rejection criteria and acceptance rules remain disabled until an approved centre SOP is configured. Do not use this screen to make clinical suitability decisions without that policy.</p></section><SamplesDirectory mode="exceptions" grants={staff.grants}/></>}</AdminShell>; }
