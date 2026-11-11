import { AdminShell } from "@/components/admin/admin-shell";
import { CampaignWorkbench } from "@/components/marketing/campaign-workbench";
import Link from "next/link";

export default function MarketingCampaignsPage() {
  return <AdminShell permission="marketing.read" title="Campaign attribution">{(staff) => <><nav className="page-actions" aria-label="Marketing workspaces"><Link className="button button-secondary" href="/marketing/content">Content calendar</Link><Link className="button button-secondary" href="/marketing/design/m010">Open 11 Phase 09 design references</Link></nav><CampaignWorkbench managedCentreIds={staff.grants.filter((grant) => grant.key === "marketing.manage").map((grant) => grant.centreId ?? "*")} /></>}</AdminShell>;
}
