import { AdminShell } from "@/components/admin/admin-shell";
import { FinancePhase06Screen } from "@/components/finance/phase-06-screen";
export default function FinanceAnalyticsPage() { return <AdminShell permission="finance.read" title="Financial analytics">{() => <FinancePhase06Screen screen="analytics" />}</AdminShell>; }
