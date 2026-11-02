import { ActionButton } from "@/components/ui/action-button";
import { PageTitle } from "@/components/ui/page-title";
import { PublicContentOverride } from "@/components/website/public-content-override";
import { getPublishedWebsiteMetadata } from "@/server/public-website-content";

export async function generateMetadata() { return getPublishedWebsiteMetadata("home-collection", { title: "Home collection" }); }

export default function HomeCollectionPage() {
  return <PublicContentOverride slug="home-collection" fallback={<div className="inner-page">
    <PageTitle eyebrow="Home collection" title="Plan a collection request" description="Home collection depends on centre coverage, staff availability and service requirements. A request must be confirmed by Rudra before it is scheduled." />
    <section className="notice"><span className="notice-icon" aria-hidden="true">i</span><div><h2>Booking is not confirmed online</h2><p>This site does not currently create a collection booking, assign a phlebotomist or collect payment. Any applicable home-visit charge is separate from diagnostic test or package prices and must be confirmed by the centre.</p></div></section>
    <div className="page-actions"><ActionButton href="/service-areas" variant="secondary">Search service areas</ActionButton><ActionButton href="/centres" variant="secondary">Find a published centre</ActionButton><ActionButton href="/book">Booking information</ActionButton></div>
  </div>} />;
}
