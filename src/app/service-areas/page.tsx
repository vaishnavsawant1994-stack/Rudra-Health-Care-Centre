import { PublicCentresDirectory } from "@/components/centres/public-centres-directory";
import { PageTitle } from "@/components/ui/page-title";
import { PublicContentSections } from "@/components/website/public-content-override";
import { getPublishedWebsiteMetadata } from "@/server/public-website-content";

export async function generateMetadata() { return getPublishedWebsiteMetadata("service-areas", { title: "Service areas" }); }

export default function ServiceAreasPage() {
  return <div className="inner-page">
    <PageTitle eyebrow="Home collection" title="Published service areas" description="Search areas that Rudra centre teams have explicitly published for home-collection enquiries." />
    <section className="notice"><span className="notice-icon" aria-hidden="true">i</span><div><h2>Area listings are a starting point</h2><p>A listed area does not confirm availability, an appointment, a test or a price. Rudra staff must review each request and confirm coverage, timing and any separate home-visit charge.</p></div></section>
    <PublicContentSections slug="service-areas" showTitle={false} />
    <PublicCentresDirectory serviceAreasOnly />
  </div>;
}
