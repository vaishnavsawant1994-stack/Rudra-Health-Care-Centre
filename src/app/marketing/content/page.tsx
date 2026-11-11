import Link from "next/link";
import { AdminShell } from "@/components/admin/admin-shell";
import { ContentCalendarWorkbench } from "@/components/marketing/content-calendar-workbench";

export default function MarketingContentPage() {
  return <AdminShell permission="marketing.read" title="Marketing content calendar">{(staff) => <><nav className="page-actions" aria-label="Marketing workspaces"><Link className="button button-secondary" href="/marketing/campaigns">Campaign attribution</Link><Link className="button button-secondary" href="/marketing/design/m003">Open 11 Phase 09 design references</Link></nav>{staff.grants.some((grant) => grant.key === "marketing.manage") ? <ContentCalendarWorkbench /> : <p role="status">Content calendar management is not permitted for this account.</p>}</>}</AdminShell>;
}
