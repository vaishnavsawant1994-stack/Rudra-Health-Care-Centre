import { PageTitle } from "@/components/ui/page-title";
import { PublicCentresDirectory } from "@/components/centres/public-centres-directory";
import { PublicEnquiryForm } from "@/components/leads/public-enquiry-workbench";
import { PublicContentSections } from "@/components/website/public-content-override";
import { getPublishedWebsiteMetadata } from "@/server/public-website-content";

export async function generateMetadata() { return getPublishedWebsiteMetadata("contact", { title: "Contact Rudra" }); }

export default function ContactPage() {
  return <div className="inner-page"><PageTitle eyebrow="Contact Rudra" title="How can we help?" description="Find a Rudra centre or send a service enquiry. A staff member will review enquiries before they are added to the CRM."/><PublicContentSections slug="contact" showTitle={false}/><section className="public-centre-contact"><h2>Published centre contact details</h2><p>Contact information appears only when a centre has an explicitly published public profile.</p><PublicCentresDirectory /></section><PublicEnquiryForm/><p className="public-catalogue-note">Do not use this form for emergencies, medical advice, report interpretation or sharing diagnostic documents. Online appointments, external messages and patient account services are not activated by this form.</p></div>;
}
