import { PublicEnquiryForm } from "@/components/leads/public-enquiry-workbench";
import { PageTitle } from "@/components/ui/page-title";
import { ActionButton } from "@/components/ui/action-button";
import { PublicContentSections } from "@/components/website/public-content-override";
import { getPublishedWebsiteMetadata } from "@/server/public-website-content";

export async function generateMetadata() { return getPublishedWebsiteMetadata("booking", { title: "Request an appointment" }); }

export default function BookingPage() {
  return <div className="inner-page">
    <PageTitle eyebrow="Plan a visit" title="Request an appointment" description="Send a preferred service and visit time to Rudra staff for review." />
    <PublicContentSections slug="booking" showTitle={false} />
    <PublicEnquiryForm mode="booking" />
    <div className="page-actions"><ActionButton href="/tests" variant="secondary">Browse tests</ActionButton><ActionButton href="/packages" variant="secondary">Browse packages</ActionButton></div>
  </div>;
}
