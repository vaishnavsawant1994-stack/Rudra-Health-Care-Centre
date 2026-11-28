import { AdminShell } from "@/components/admin/admin-shell";
import { FinancePhase06Screen } from "@/components/finance/phase-06-screen";
export default function MetropolisSettlementPage() { return <AdminShell permission="finance.read" title="Metropolis settlement ledger">{() => <FinancePhase06Screen screen="metropolis" />}</AdminShell>; }
