import { PageTitle } from "@/components/ui/page-title";
import { ActionButton } from "@/components/ui/action-button";
import { PublicCatalogueDirectory } from "@/components/catalogue/public-catalogue-directory";
import { PublicContentSections } from "@/components/website/public-content-override";
import { getPublishedWebsiteMetadata } from "@/server/public-website-content";
export async function generateMetadata() { return getPublishedWebsiteMetadata("packages", { title: "Health packages" }); }
export default function PackagesPage(){return <div className="inner-page"><PageTitle eyebrow="Explore packages" title="Health packages" description="Browse currently published diagnostic packages and verified prices at Rudra Health Care Centre."/><PublicContentSections slug="packages" showTitle={false}/><PublicCatalogueDirectory serviceType="PACKAGE"/><div className="page-actions"><ActionButton href="/tests" variant="secondary">Explore tests</ActionButton><ActionButton href="/book">Booking information</ActionButton></div></div>}
