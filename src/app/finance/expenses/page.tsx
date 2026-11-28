import { AdminShell } from "@/components/admin/admin-shell";
import { FinancePhase06Screen } from "@/components/finance/phase-06-screen";
export default function ExpensesPage() { return <AdminShell permission="finance.read" title="Expenses and petty cash">{() => <FinancePhase06Screen screen="expenses" />}</AdminShell>; }
