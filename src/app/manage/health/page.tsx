import { AdminShell } from "@/components/admin/admin-shell";
import { AdminDataPanel } from "@/components/admin/admin-data-panel";

export default function OperationsHealthPage() {
  return <AdminShell permission="configuration.read" title="Business continuity and health monitor"><><p className="admin-card">O016 · Current configuration readiness is loaded from the system API. This is not backup completion or restore qualification evidence.</p><AdminDataPanel endpoint="/api/admin/system" label="Configuration and integration readiness"/><section className="admin-card"><h2>Recovery qualification gaps</h2><p>Backup integrity, encrypted-document restore, key recovery, migration preflight and disaster recovery have not been qualified by this screen. Persistent development database migrations remain untouched.</p></section></></AdminShell>;
}
