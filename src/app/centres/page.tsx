import { ActionButton } from "@/components/ui/action-button";
import { PublicCentresDirectory } from "@/components/centres/public-centres-directory";
import { PublicContentSections } from "@/components/website/public-content-override";
import { getPublishedWebsiteMetadata } from "@/server/public-website-content";

export async function generateMetadata() { return getPublishedWebsiteMetadata("centres", { title: "Centres" }); }

export default function CentresPage() {
  return <main className="rp-centres-page">
    <section className="rp-centres-hero"><div><span className="r-eyebrow">RUDRA HEALTH CARE CENTRES</span><h1>Find a Rudra centre near you</h1><h2>Convenient. Accessible. Trusted diagnostic care.</h2><p>Search centres and review location details that Rudra staff have approved for public viewing.</p><div className="rp-access-points"><span>✓ Centre information</span><span>✓ Published services</span><span>✓ Contact details when available</span></div></div><div className="rp-centres-hero-image" role="img" aria-label="Illustrative family receiving healthcare support"/><aside><b>Service availability</b><p>Centre details, home collection coverage and hours can vary. Contact the centre to confirm before travelling.</p><ActionButton href="/home-collection" variant="secondary">Home collection information</ActionButton></aside></section>
    <PublicContentSections slug="centres" showTitle={false} />
    <section className="rp-centres-directory"><div><span className="r-eyebrow">CENTRE DIRECTORY</span><h2>Search published centre information</h2><p>Only active centres and details explicitly published by authorized staff are shown below.</p></div><PublicCentresDirectory /></section>
    <div className="rp-centres-support"><article><b>Looking for a test?</b><p>Browse services currently published in the diagnostic catalogue.</p><ActionButton href="/tests" variant="secondary">Browse tests</ActionButton></article><article><b>Need a health package?</b><p>Review package information and current published prices.</p><ActionButton href="/packages" variant="secondary">Browse packages</ActionButton></article><article><b>Need help?</b><p>Ask Rudra for general service information.</p><ActionButton href="/contact" variant="secondary">Contact Rudra</ActionButton></article></div>
    <p className="public-catalogue-note">Centre names, locations, hours, services and prices are shown only when authorized staff publish them. A public listing does not confirm appointment availability.</p>
  </main>;
}
