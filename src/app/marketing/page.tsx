import "./phase09-workspace.css";
import { AdminShell } from "@/components/admin/admin-shell";
import { MarketingHomeDashboard } from "@/components/marketing/marketing-home-dashboard";

export default function MarketingHomePage() {
  return <AdminShell permission="marketing.read" title="Marketing home dashboard"><MarketingHomeDashboard /></AdminShell>;
}
