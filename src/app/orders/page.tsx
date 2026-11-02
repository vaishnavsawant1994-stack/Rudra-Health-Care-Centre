import { AdminShell } from "@/components/admin/admin-shell";
import { OrderDirectory } from "@/components/orders/order-workbench";

export default function OrdersPage() {
  return <AdminShell permission="orders.read" title="Diagnostic orders">{(staff) => <OrderDirectory canCreate={staff.grants.some((grant) => grant.key === "orders.create")} />}</AdminShell>;
}
