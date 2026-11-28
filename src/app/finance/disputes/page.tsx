import { AdminShell } from "@/components/admin/admin-shell";
import { FinancePhase06Screen } from "@/components/finance/phase-06-screen";
export default function FinanceDisputesPage() { return <AdminShell permission="finance.read" title="Disputes and corrections">{() => <FinancePhase06Screen screen="disputes" />}</AdminShell>; }
