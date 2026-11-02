import { AdminShell } from "@/components/admin/admin-shell";
import { PageTitle } from "@/components/ui/page-title";
import { LeadAnalytics } from "@/components/leads/lead-analytics";

export default function LeadAnalyticsPage() {
  return <AdminShell permission="leads.read" title="CRM acquisition overview"><PageTitle eyebrow="CRM analytics" title="Lead acquisition overview" description="Review centre-scoped enquiry volume and patient conversions from the existing CRM records."/><LeadAnalytics /></AdminShell>;
}
