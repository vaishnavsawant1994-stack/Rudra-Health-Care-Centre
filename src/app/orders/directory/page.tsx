import { AdminShell } from "@/components/admin/admin-shell";
import { OrderDirectory } from "@/components/orders/order-workbench";

export default function OrderDirectoryPage() {
  return <AdminShell permission="orders.read" title="Diagnostic order directory"><OrderDirectory showSummary={false} /></AdminShell>;
}
