import { ActionButton } from "@/components/ui/action-button";
import { PageTitle } from "@/components/ui/page-title";
import { PublicContentOverride } from "@/components/website/public-content-override";
import { getPublishedWebsiteMetadata } from "@/server/public-website-content";

export async function generateMetadata() { return getPublishedWebsiteMetadata("about", { title: "About Rudra" }); }

export default function AboutPage() {
  return <PublicContentOverride slug="about" fallback={<div className="inner-page">
    <PageTitle eyebrow="About Rudra" title="A clearer path through diagnostic care" description="Rudra Health Care Centre is building a connected experience for exploring diagnostic services and coordinating care." />
    <section className="notice"><span className="notice-icon" aria-hidden="true">R+</span><div><h2>Information you can check</h2><p>Service listings on this site appear only when the centre has published a current, verified catalogue record. An online listing does not itself confirm a booking, laboratory availability or report readiness.</p></div></section>
    <div className="page-actions"><ActionButton href="/centres" variant="secondary">Find a centre</ActionButton><ActionButton href="/tests">Explore published tests</ActionButton></div>
  </div>} />;
}
