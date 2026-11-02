import { AdminShell } from "@/components/admin/admin-shell";
import { SamplesDirectory } from "@/components/samples/sample-workbench";

export default function SampleExceptionsPage() {
  return <AdminShell permission="samples.read" title="Sample exceptions">{(staff) => <SamplesDirectory mode="exceptions" grants={staff.grants} />}</AdminShell>;
}
