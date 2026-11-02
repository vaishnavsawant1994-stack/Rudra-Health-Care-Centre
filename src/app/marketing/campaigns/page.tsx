import { AdminShell } from "@/components/admin/admin-shell";
import { CampaignWorkbench } from "@/components/marketing/campaign-workbench";
import Link from "next/link";

export default function MarketingCampaignsPage() {
  return <AdminShell permission="marketing.read" title="Campaign attribution">{(staff) => <><nav className="page-actions" aria-label="Marketing workspaces"><Link className="button button-secondary" href="/marketing/content">Content calendar</Link></nav>{staff.grants.some((grant) => grant.key === "marketing.manage") ? <CampaignWorkbench /> : <p role="status">Campaign management is not permitted for this account.</p>}</>}</AdminShell>;
}
