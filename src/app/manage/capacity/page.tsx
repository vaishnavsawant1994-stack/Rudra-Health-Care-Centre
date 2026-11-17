import { AdminShell } from "@/components/admin/admin-shell";
import { Phase10Restricted } from "@/components/operations/phase10-restricted";

export default function CapacityPage() {
  return <AdminShell permission="centres.read" title="Service area and capacity manager"><Phase10Restricted screen="O004" title="Service coverage and capacity are not configured" reason="The current source does not provide an authoritative serviceability engine or approved capacity rules. Centre records and appointment queues do not establish available slots or geographic coverage." dependencies={["Approved centre service-area and capacity data model", "Authorized service-area publishing and change history", "Server-side availability policy and centre-scoped tests"]} /></AdminShell>;
}
