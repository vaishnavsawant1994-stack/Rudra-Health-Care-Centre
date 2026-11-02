import { AdminShell } from "@/components/admin/admin-shell";
import { WebsiteContentAdmin } from "@/components/website/website-content-admin";

export default function WebsiteContentPage() {
  return <AdminShell permission="website.content.manage" title="Website content">{(staff) => <WebsiteContentAdmin canPublish={staff.grants.some((grant) => grant.key === "website.content.publish")} canReview={staff.grants.some((grant) => grant.key === "website.content.review")} />}</AdminShell>;
}
