import { ActionButton } from "@/components/ui/action-button";
import { PageTitle } from "@/components/ui/page-title";
import { PublicCentresDirectory } from "@/components/centres/public-centres-directory";
import { PublicContentSections } from "@/components/website/public-content-override";
import { getPublishedWebsiteMetadata } from "@/server/public-website-content";

export async function generateMetadata() { return getPublishedWebsiteMetadata("centres", { title: "Centres" }); }

export default function CentresPage() {
  return <div className="inner-page">
    <PageTitle eyebrow="Find a location" title="Rudra centres" description="Browse Rudra centres with public information explicitly published by authorized staff." />
    <PublicContentSections slug="centres" showTitle={false} />
    <PublicCentresDirectory />
    <div className="page-actions"><ActionButton href="/tests" variant="secondary">Browse tests</ActionButton><ActionButton href="/packages" variant="secondary">Browse packages</ActionButton></div>
    <p className="public-catalogue-note">A centre can receive an enquiry even when no catalogue service is currently published. Service listings, prices, contact details and location information appear only when authorized staff publish them.</p>
  </div>;
}
