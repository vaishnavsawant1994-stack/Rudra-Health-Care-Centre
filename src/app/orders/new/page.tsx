import { AdminShell } from "@/components/admin/admin-shell";
import { OrderCreate } from "@/components/orders/order-workbench";

export default function NewOrderPage() {
  return <AdminShell permission="orders.create" title="New diagnostic order"><OrderCreate /></AdminShell>;
}
