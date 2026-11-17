import { AdminShell } from "@/components/admin/admin-shell";
import { Phase10Restricted } from "@/components/operations/phase10-restricted";

export default function SopsPage() {
  return <AdminShell permission="configuration.read" title="SOP library and staff training"><Phase10Restricted screen="O009" title="Approved SOP and training evidence is unavailable" reason="No authoritative SOP version library, staff acknowledgement or training completion records are present in the current source. Draft documents and UI references are not proof of approval or completion." dependencies={["Controlled SOP version registry and approver roles", "Staff acknowledgements and training assignment records", "Evidence retention and audit history"]} /></AdminShell>;
}
