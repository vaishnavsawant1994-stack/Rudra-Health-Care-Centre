import { AdminShell } from "@/components/admin/admin-shell";
import { DispatchBatchDetail } from "@/components/samples/sample-workbench";

export const instant = false;
export default async function DispatchBatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminShell permission="samples.read" title="Dispatch batch">{(staff) => <DispatchBatchDetail id={id} grants={staff.grants} />}</AdminShell>;
}
