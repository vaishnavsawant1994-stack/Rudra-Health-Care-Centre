import Link from "next/link";
import { PageTitle } from "@/components/ui/page-title";
import { PublicEnquiryForm } from "@/components/leads/public-enquiry-workbench";
import { PublicContentSections } from "@/components/website/public-content-override";

type PageKind = "corporate" | "doctors" | "partners";

const content: Record<PageKind, { eyebrow: string; title: string; description: string; points: string[]; contact: string }> = {
  corporate: {
    eyebrow: "Organizations",
    title: "Diagnostic service enquiries for organizations",
    description: "Rudra Health Care Centre can review organization-level questions about diagnostic services, centre coordination and employee booking requests. Every request is reviewed by staff; this page does not create a contract, booking, negotiated rate or service commitment.",
    points: ["Discuss your organization's requirements with the Rudra team.", "Ask about centre coordination and service information currently published by Rudra.", "Any agreement, eligibility, price or service arrangement requires separate review and authorization."],
    contact: "Send an organization enquiry",
  },
  doctors: {
    eyebrow: "Healthcare professionals",
    title: "Information for referring doctors",
    description: "Doctors can contact Rudra Health Care Centre with questions about available diagnostic services and coordination. This information page does not establish a referral agreement or authorize access to patient records.",
    points: ["Ask about services listed in Rudra's current catalogue.", "Coordinate a permitted operational enquiry with the Rudra team.", "Patient information is shared only under applicable, verified authorization."],
    contact: "Contact Rudra",
  },
  partners: {
    eyebrow: "Partners",
    title: "Partner with Rudra Health Care Centre",
    description: "Organizations interested in a service or referral relationship can submit an enquiry for staff review. Submission does not create a partnership, referral entitlement, commission, pricing arrangement or access to patient information.",
    points: ["Describe the proposed operational relationship.", "Rudra staff will review the request and any required authorization.", "Agreements and any commercial terms require separate approval."],
    contact: "Send a partner enquiry",
  },
};

export function BusinessServicesPage({ kind }: { kind: PageKind }) {
  const page = content[kind];
  return <div className="inner-page"><PageTitle eyebrow={page.eyebrow} title={page.title} description={page.description}/><PublicContentSections slug={kind}/><section className="notice"><div><h2>How requests are handled</h2><ul className="public-business-points">{page.points.map((point) => <li key={point}>{point}</li>)}</ul><p>Do not submit patient identifiers, reports, medical history or urgent health information through a general enquiry.</p><div className="page-actions"><Link className="button button-secondary" href="/centres">View Rudra centres</Link></div></div></section><section className="public-business-enquiry"><h2>{page.contact}</h2><p>Requests are encrypted, routed to the selected centre and reviewed by authorized staff. A submission does not enroll you in marketing or confirm any service.</p><PublicEnquiryForm topic={kind === "doctors" ? "DOCTOR" : kind === "corporate" ? "CORPORATE" : "PARTNER"}/></section></div>;
}
