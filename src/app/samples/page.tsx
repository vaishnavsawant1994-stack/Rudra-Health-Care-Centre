import { AdminShell } from "@/components/admin/admin-shell";
import { SamplesDirectory } from "@/components/samples/sample-workbench";

export default function SamplesPage() {
  return <AdminShell permission="samples.read" title="Sample management">{(staff) => <SamplesDirectory grants={staff.grants} />}</AdminShell>;
}
