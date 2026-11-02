import { AdminShell } from "@/components/admin/admin-shell";
import { AdminDataPanel } from "@/components/admin/admin-data-panel";
export default async function AuditPage() { return <AdminShell permission="audit.read" title="Audit activity"><AdminDataPanel endpoint="/api/admin/audit" label="Latest audit events" /><p className="setup-notice">Events are append-only and hash chained. Verify the chain with <code>npm run db:verify-audit</code>.</p></AdminShell>; }
