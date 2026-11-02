import { AdminShell } from "@/components/admin/admin-shell";
import { ProcedureReferenceManager } from "@/components/samples/sample-workbench";

export default function SampleProcedurePage() {
  return <AdminShell permission="samples.procedures.manage" title="Approved procedure references"><ProcedureReferenceManager /></AdminShell>;
}
