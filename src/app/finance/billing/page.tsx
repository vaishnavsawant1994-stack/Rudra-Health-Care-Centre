import { AdminShell } from "@/components/admin/admin-shell";
import { FinancePhase06Screen } from "@/components/finance/phase-06-screen";
export default function BillingQueuePage() { return <AdminShell permission="finance.read" title="Billing work queue">{() => <FinancePhase06Screen screen="billing" />}</AdminShell>; }
