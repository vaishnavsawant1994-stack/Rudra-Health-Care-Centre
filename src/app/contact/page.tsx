import { PageTitle } from "@/components/ui/page-title";
import { PublicEnquiryForm } from "@/components/leads/public-enquiry-workbench";
import { PublicContentSections } from "@/components/website/public-content-override";
import { getPublishedWebsiteMetadata } from "@/server/public-website-content";

export async function generateMetadata() { return getPublishedWebsiteMetadata("contact", { title: "Contact Rudra" }); }

export default function ContactPage() {
  return <div className="inner-page"><PageTitle eyebrow="Contact Rudra" title="How can we help?" description="Send a service enquiry to Rudra Health Care Centre. A staff member will review it before it is added to the CRM."/><PublicContentSections slug="contact" showTitle={false}/><PublicEnquiryForm/><p className="public-catalogue-note">Do not use this form for emergencies, medical advice, report interpretation or sharing diagnostic documents. Online appointments, external messages and patient account services are not activated by this form.</p></div>;
}
