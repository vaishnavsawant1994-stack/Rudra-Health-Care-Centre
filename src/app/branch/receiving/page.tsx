import { AdminShell } from "@/components/admin/admin-shell";
import { SamplesDirectory } from "@/components/samples/sample-workbench";

export default function RudraReceivingPage() {
  return <AdminShell permission="samples.receive" title="Rudra sample receiving">{(staff) => <SamplesDirectory mode="receiving" grants={staff.grants} />}</AdminShell>;
}
