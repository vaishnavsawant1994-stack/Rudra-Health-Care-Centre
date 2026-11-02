import { AdminShell } from "@/components/admin/admin-shell";
import { LeadFollowups } from "@/components/leads/lead-workbench";

export default function LeadFollowupsPage() { return <AdminShell permission="leads.followups.manage" title="Follow-ups & reminders"><LeadFollowups /></AdminShell>; }
