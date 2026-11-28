import { AdminShell } from "@/components/admin/admin-shell";
import { CampaignWorkbench } from "@/components/marketing/campaign-workbench";
import { MarketingScreenNavigation } from "@/components/marketing/phase09-marketing-screens";

export default function MarketingCampaignsPage() {
  return <AdminShell permission="marketing.read" title="Campaign directory and planner">{(staff) => <><MarketingScreenNavigation current="campaigns" /><p role="note">Campaign state is for internal lead attribution only. Activating tracking does not launch an external campaign or authorize a budget.</p><CampaignWorkbench managedCentreIds={staff.grants.filter((grant) => grant.key === "marketing.manage").map((grant) => grant.centreId ?? "*")} /></>}</AdminShell>;
}
