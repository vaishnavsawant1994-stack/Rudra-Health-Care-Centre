import { AdminShell } from "@/components/admin/admin-shell";
import { SamplesDirectory } from "@/components/samples/sample-workbench";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";

export default function SamplesPage() {
  return <AdminShell permission="samples.read" title="Sample management">{(staff) => <><SampleWorkflowNav current="L002" /><SamplesDirectory grants={staff.grants} /></>}</AdminShell>;
}
