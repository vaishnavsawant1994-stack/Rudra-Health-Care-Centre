import { AdminShell } from "@/components/admin/admin-shell";
import { AdminDataPanel } from "@/components/admin/admin-data-panel";

export default function OperationsAuditPage() {
  return <AdminShell permission="audit.read" title="Audit, compliance and access anomalies"><p className="admin-card">O015 · The audit API filters records by the signed-in staff authorization. Avoid exporting patient details or sensitive payloads.</p><AdminDataPanel endpoint="/api/admin/audit" label="Authorized audit events"/><p className="setup-notice">This screen does not claim anomaly detection or a complete compliance assessment.</p></AdminShell>;
}
