import { AdminShell } from "@/components/admin/admin-shell";
import { CampaignWorkbench } from "@/components/marketing/campaign-workbench";
import { MarketingScreenNavigation } from "@/components/marketing/phase09-marketing-screens";

export default function MarketingAttributionPage() {
  return <AdminShell permission="marketing.read" title="Marketing lead attribution"><>
    <MarketingScreenNavigation current="attribution" />
    <CampaignWorkbench managedCentreIds={[]} attributionOnly />
  </></AdminShell>;
}
