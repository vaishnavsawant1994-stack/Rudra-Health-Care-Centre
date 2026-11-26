import { AdminShell } from "@/components/admin/admin-shell";
import { AuditWorkbench } from "@/components/admin/audit-workbench";

export default function OperationsAuditPage() {
  return <AdminShell permission="audit.read" title="Audit, compliance and access anomalies"><p className="admin-card">O015 · Organization-scoped audit permission is required. Authorized reviewers can filter the immutable event history; this screen does not claim anomaly detection or a complete compliance assessment.</p><AuditWorkbench /></AdminShell>;
}
