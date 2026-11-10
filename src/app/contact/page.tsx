import Link from "next/link";
import { PublicCentresDirectory } from "@/components/centres/public-centres-directory";
import { PublicEnquiryForm } from "@/components/leads/public-enquiry-workbench";
import { PublicContentSections } from "@/components/website/public-content-override";
import { getPublishedWebsiteMetadata } from "@/server/public-website-content";

export async function generateMetadata() { return getPublishedWebsiteMetadata("contact", { title: "Contact Rudra", description: "Find published Rudra centre details or send a staff-reviewed service enquiry." }); }

export default function ContactPage() {
  return <main className="ref-contact-page">
    <PublicContentSections slug="contact" showTitle={false}/>
    <section className="ref-contact-hero"><div><span className="eyebrow">CONTACT & HELP CENTRE</span><h1>How can we help?</h1><p>We can help you find service information, published centre details and the right next step for a booking enquiry.</p><p>Choose a support topic below or send a request for the Rudra team to review.</p><div className="ref-actions"><Link className="button button-primary" href="#send-enquiry">Send an enquiry</Link><Link className="button button-secondary" href="/faq">Browse FAQs</Link></div></div><div className="ref-contact-art" role="img" aria-label="Illustrative support team image"/></section>
    <section className="ref-contact-options"><Link href="/centres"><span aria-hidden="true">⌖</span><strong>Centre details</strong><small>View only information published by Rudra</small></Link><Link href="/home-collection"><span aria-hidden="true">⌂</span><strong>Home collection</strong><small>Read how visit requests are reviewed</small></Link><Link href="/faq"><span aria-hidden="true">?</span><strong>Common questions</strong><small>Search current service and privacy answers</small></Link><Link href="/chat"><span aria-hidden="true">◌</span><strong>Service guide</strong><small>Fixed-choice help, not AI or medical advice</small></Link></section>
    <div className="ref-contact-columns"><section className="ref-contact-centres"><div className="ref-contact-section-heading"><span className="eyebrow">PUBLISHED LOCATIONS</span><h2>Published centre contact details</h2><p>Contact information appears only when an authorized Rudra staff member publishes it.</p></div><PublicCentresDirectory/><p className="public-catalogue-note">Centre listings do not confirm service availability, appointment capacity or home-collection coverage.</p></section><section className="ref-contact-enquiry" id="send-enquiry"><div className="ref-contact-section-heading"><span className="eyebrow">STAFF-REVIEWED REQUEST</span><h2>Send us an enquiry</h2><p>Share only the information needed for the team to respond. This form does not create a confirmed appointment.</p></div><PublicEnquiryForm/><p className="public-catalogue-note">Do not use this form for emergencies, medical advice, report interpretation or diagnostic documents. patient account services are not activated; external messages are not activated here.</p></section></div>
    <section className="ref-contact-safety"><strong>Need urgent medical assistance?</strong><span>This website is not an emergency service. Contact your local emergency service or visit an appropriate care provider.</span></section>
  </main>;
}
