import { AdminShell } from "@/components/admin/admin-shell";
import { Phase10Restricted } from "@/components/operations/phase10-restricted";

export default function PurchasingPage() {
  return <AdminShell permission="configuration.read" title="Procurement and reorder approvals"><Phase10Restricted screen="O011" title="Procurement workflow is unavailable" reason="No supplier, purchase request/order, receipt or reconciliation contracts are present. No request is presented as approved, ordered, delivered or paid." dependencies={["Supplier and purchase-order records", "Separation-of-duties approval policy", "Receiving and invoice reconciliation with immutable history"]} /></AdminShell>;
}
