import { AdminShell } from "@/components/admin/admin-shell";
import { FinanceWorkbench } from "@/components/finance/finance-workbench";
export default function DailyClosePage() { return <AdminShell permission="finance.reconcile" title="Daily cash and UPI close">{staff => <FinanceWorkbench mode="reconciliation" grants={staff.grants} />}</AdminShell>; }
