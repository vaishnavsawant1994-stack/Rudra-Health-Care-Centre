import { AdminShell } from "@/components/admin/admin-shell";
import { Phase10Restricted } from "@/components/operations/phase10-restricted";

export default function InventoryPage() {
  return <AdminShell permission="configuration.read" title="Inventory dashboard and stock movements"><Phase10Restricted screen="O010" title="Inventory is restricted until a stock ledger exists" reason="The current schema does not contain inventory items, lots, expiry, receipts, issues, transfers or adjustments. The interface therefore displays no stock balances or movements." dependencies={["Centre-scoped item, batch and expiry schema", "Append-only stock movement ledger and reconciliation", "Tested authorization, idempotency and no-negative-stock rules"]} /></AdminShell>;
}
