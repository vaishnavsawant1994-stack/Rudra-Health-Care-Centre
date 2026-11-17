import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { CommunicationGovernanceWorkbench } from "@/components/communications/communication-governance-workbench";

export default function AdminAutomationPage() {
  return <AdminShell permission="configuration.manage" title="Notifications, integrations and task automation">{(staff) => <>
    <section className="admin-card"><p className="eyebrow">S011 · Governance drafts only</p><p>Provider policy drafts are centre-scoped, encrypted, versioned and audited. Saving a draft does not connect a provider, schedule a job or send a message.</p><p>Delivery, calling, external notifications and automatic task execution remain disabled unless separately authorized and verified.</p></section>
    <CommunicationGovernanceWorkbench kind="PROVIDER_POLICY" canManage={staff.grants.some((grant) => grant.key === "configuration.manage")} />
    <section className="admin-card"><h2>Existing task approval governance</h2><p><Link href="/tasks/approvals/policies">Review staff task approval policies</Link>. Approval deadlines and policy events do not establish that an external notification was delivered.</p></section>
  </>}</AdminShell>;
}
