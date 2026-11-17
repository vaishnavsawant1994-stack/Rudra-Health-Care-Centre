import { AdminShell } from "@/components/admin/admin-shell";
import { FinancePhase06Screen } from "@/components/finance/phase-06-screen";
export default function PartnerBillingPage() { return <AdminShell permission="finance.read" title="Corporate and partner billing">{() => <FinancePhase06Screen screen="partners" />}</AdminShell>; }
