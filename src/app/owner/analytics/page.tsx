import { AdminShell } from "@/components/admin/admin-shell";
import { OwnerAnalyticsWorkbench } from "@/components/owner/owner-analytics-workbench";

export default function OwnerAnalyticsPage() {
  return <AdminShell permission="organization.read" title="Operational analytics">{() => <OwnerAnalyticsWorkbench />}</AdminShell>;
}
