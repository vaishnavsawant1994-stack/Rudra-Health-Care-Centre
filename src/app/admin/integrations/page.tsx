import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { SampleWorkflowNav } from "@/components/branch/sample-workflow-nav";
import { MetropolisWorkbench } from "@/components/samples/metropolis-workbench";

export default function AdminIntegrationsPage() {
  return <AdminShell permission="samples.read" title="Metropolis adapter and import configuration">{(staff) => <>
    <SampleWorkflowNav current="L008" />
    <section className="admin-card"><p className="eyebrow">S006 · Manual-first mode</p><h2>Reference mapping workbench</h2><p>Records here are staff-entered references with evidence; they do not configure or connect a Metropolis API.</p><p><Link href="/integrations/metropolis/imports">Review manual import readiness</Link> · <Link href="/integrations/metropolis/status">Review staff-recorded status evidence</Link></p></section>
    <MetropolisWorkbench mode="references" grants={staff.grants} staffId={staff.staffUserId} />
    <section className="admin-card"><h2>Provider configuration unavailable</h2><p>No API calls, automatic imports or external synchronization are enabled. Provider authorization, approved data-use terms and a validated contract remain prerequisites.</p></section>
  </>}</AdminShell>;
}
