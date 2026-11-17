import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { Phase10Restricted } from "@/components/operations/phase10-restricted";

export default function OperationalSlaPage() {
  return <AdminShell permission="tasks.policy.manage" title="Operational SLA and escalation policies"><><Phase10Restricted screen="O007" title="SLA thresholds are not active" reason="The existing staff task approval policy is not an operational SLA policy. No deadline or automated escalation is inferred from task due dates." dependencies={["Versioned SLA policy schema and centre overrides", "Independent review and approval workflow", "Verified event timestamps and tested escalation job"]} /><p className="admin-card">Existing task approval governance: <Link href="/tasks/approvals/policies">review approval policy records</Link>.</p></></AdminShell>;
}
