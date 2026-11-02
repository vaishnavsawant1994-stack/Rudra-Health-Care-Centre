import { AdminShell } from "@/components/admin/admin-shell";
import { DispatchDesk } from "@/components/samples/sample-workbench";

export default function DispatchPage() {
  return <AdminShell permission="samples.dispatch" title="Sample packing & dispatch">{(staff) => <DispatchDesk grants={staff.grants} />}</AdminShell>;
}
