import { AdminShell } from "@/components/admin/admin-shell";
import { FinanceWorkbench } from "@/components/finance/finance-workbench";
export default function BillingQueuePage() { return <AdminShell permission="finance.read" title="Billing work queue">{staff => <FinanceWorkbench mode="billing" grants={staff.grants} />}</AdminShell>; }
