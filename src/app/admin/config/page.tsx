import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { AdminDataPanel } from "@/components/admin/admin-data-panel";

export default function AdminConfigPage() {
  return <AdminShell permission="configuration.read" title="System configuration and feature flags"><>
    <p className="admin-card">S005 · This page reads current setup readiness. It does not apply configuration changes or activate feature flags.</p>
    <AdminDataPanel endpoint="/api/admin/system" label="Observed configuration readiness" />
    <section className="admin-card"><h2>Configuration changes</h2><p>Versioned owner proposals, independent approval, apply/verify states and rollback proposals are not implemented. A configured integration does not establish authorization or successful operation.</p><p><Link href="/owner/settings">Review organization settings</Link></p></section>
  </></AdminShell>;
}
