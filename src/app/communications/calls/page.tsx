import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { Phase08CapabilityBoundary, Phase08RouteNavigation } from "@/components/communications/phase08-route-support";

export default function CallActivityPage() {
  return <AdminShell permission="leads.read" title="Call history and dispositions">{() => <>
    <Phase08RouteNavigation current="A011" />
    <Phase08CapabilityBoundary title="No provider call history or recordings" state="Manual CRM activity only">
      <p>There is no telephony connection, call recording store or imported call history. Do not treat a staff activity note as a provider-verified call.</p>
      <p>Where contact permission allows it, staff may record a manual lead contact attempt and outcome on the protected Lead 360 record. Medical details must not be added to contact notes.</p>
      <Link className="button-link" href="/leads">Open authorized lead directory</Link>
    </Phase08CapabilityBoundary>
  </>}</AdminShell>;
}
