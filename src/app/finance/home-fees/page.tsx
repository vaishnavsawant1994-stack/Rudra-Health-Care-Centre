import { AdminShell } from "@/components/admin/admin-shell";
import { FinancePhase06Screen } from "@/components/finance/phase-06-screen";
export default function HomeFeeLedgerPage() { return <AdminShell permission="finance.read" title="Home collection income">{() => <FinancePhase06Screen screen="home-fees" />}</AdminShell>; }
