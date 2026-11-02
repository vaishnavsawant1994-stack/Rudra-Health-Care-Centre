import { AdminShell } from "@/components/admin/admin-shell";
import { CollectionOperations } from "@/components/samples/sample-workbench";

export default function CollectionsPage() {
  return <AdminShell permission="collections.read" title="Collection operations">{(staff) => <CollectionOperations grants={staff.grants} />}</AdminShell>;
}
