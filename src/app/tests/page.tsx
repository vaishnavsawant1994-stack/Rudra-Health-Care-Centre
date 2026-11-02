import { PageTitle } from "@/components/ui/page-title";
import { ActionButton } from "@/components/ui/action-button";
import { PublicCatalogueDirectory } from "@/components/catalogue/public-catalogue-directory";
import { PublicContentSections } from "@/components/website/public-content-override";
import { getPublishedWebsiteMetadata } from "@/server/public-website-content";
export async function generateMetadata() { return getPublishedWebsiteMetadata("tests", { title: "Diagnostic tests" }); }
export default function TestsPage(){return <div className="inner-page"><PageTitle eyebrow="Diagnostic services" title="Tests" description="Browse currently published diagnostic tests and verified prices at Rudra Health Care Centre."/><PublicContentSections slug="tests" showTitle={false}/><PublicCatalogueDirectory serviceType="TEST"/><div className="page-actions"><ActionButton href="/packages" variant="secondary">View packages</ActionButton><ActionButton href="/book">Booking information</ActionButton></div></div>}
