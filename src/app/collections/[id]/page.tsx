import { AdminShell } from "@/components/admin/admin-shell";
import { CollectionJobDetail } from "@/components/samples/sample-workbench";

export const instant = false;
export default async function CollectionJobPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminShell permission="collections.read" title="Collection job">{(staff) => <CollectionJobDetail id={id} staffId={staff.staffUserId} grants={staff.grants} />}</AdminShell>;
}
