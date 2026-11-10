import Link from "next/link";
import { PublicEnquiryForm } from "@/components/leads/public-enquiry-workbench";
import { PublicContentSections } from "@/components/website/public-content-override";

type PageKind = "corporate" | "doctors" | "partners";
type PageContent = { eyebrow: string; title: string; description: string; cards: [string, string, string]; process: [string, string, string, string]; note: string; contact: string };

const content: Record<PageKind, PageContent> = {
  corporate: {
    eyebrow: "CORPORATE DIAGNOSTIC ENQUIRIES",
    title: "A healthier workforce starts with a conversation",
    description: "Ask Rudra about diagnostic services and coordination for your organization. Every enquiry is reviewed by staff; this page does not create a contract, booking, negotiated rate or service commitment.",
    cards: ["Employee service enquiries", "Centre coordination questions", "Organization-specific discussion"],
    process: ["Share an enquiry", "Rudra staff review", "Confirm scope and policy", "Agree next steps separately"],
    note: "Packages, availability, pricing, employee-level reporting and any commercial terms require separate verification and approval.", contact: "Send an organization enquiry",
  },
  doctors: {
    eyebrow: "FOR DOCTORS & HEALTHCARE PROFESSIONALS",
    title: "Coordinate diagnostic service questions with Rudra",
    description: "Healthcare professionals can ask about diagnostic services currently published by Rudra. This information page does not establish a referral arrangement or authorize access to patient records.",
    cards: ["Published service information", "Operational coordination", "Privacy and authorization"],
    process: ["Send a professional enquiry", "Staff verify the request", "Discuss permitted coordination", "Review any agreement separately"],
    note: "Patient information is shared only under applicable, verified authorization. Do not send patient identifiers, reports or medical history through this general enquiry.", contact: "Doctor or clinic enquiry",
  },
  partners: {
    eyebrow: "PARTNER ENQUIRIES",
    title: "Explore a possible service relationship",
    description: "Organizations interested in a service or referral relationship can submit an enquiry for review. Submission does not create a partnership, referral entitlement, commission, pricing arrangement or patient-data access.",
    cards: ["Service collaboration enquiry", "Operational relationship review", "Clear approval process"],
    process: ["Describe the proposal", "Rudra reviews the request", "Verify scope and authority", "Approve terms before activation"],
    note: "Do not imply authorization to offer Metropolis services or use its marks. Agreements and any commercial or referral terms require separate approval.", contact: "Send a partner enquiry",
  },
};

export function BusinessServicesPage({ kind }: { kind: PageKind }) {
  const page = content[kind];
  return <main className={`ref-business-page ref-business-${kind}`}>
    <PublicContentSections slug={kind}/>
    <section className="ref-business-hero"><div><span className="eyebrow">{page.eyebrow}</span><h1>{page.title}</h1><p>{page.description}</p><div className="ref-actions"><a className="button button-primary" href="#business-enquiry">{page.contact} ↓</a><Link className="button button-secondary" href="/tests">Browse published services</Link></div><small>All enquiries are reviewed by Rudra staff. No external service or partner relationship is represented as active here.</small></div><div className="ref-business-art" role="img" aria-label="Illustrative healthcare collaboration image"/></section>
    <section className="ref-business-cards">{page.cards.map((item, i) => <article key={item}><span aria-hidden="true">{["◇", "⌂", "♡"][i]}</span><h2>{item}</h2><p>{i === 0 ? "Ask about information currently published by Rudra." : i === 1 ? "Requests are reviewed before any operational commitment." : "Any access, agreement or service needs separate verification."}</p></article>)}</section>
    <section className="ref-business-process"><div><span className="eyebrow">A transparent process</span><h2>How an enquiry is handled</h2><p>{page.note}</p></div><ol>{page.process.map((item, i) => <li key={item}><b>0{i + 1}</b><span>{item}</span></li>)}</ol></section>
    <section className="rp-business-overview"><div className="rp-business-section-title"><span className="r-eyebrow">HOW WE CAN HELP</span><h2>{kind === "corporate" ? "Diagnostic coordination for organizations" : kind === "doctors" ? "Practical diagnostic support for your practice" : "Explore a possible collaboration"}</h2><p>Start with a conversation. Rudra staff will confirm which services, operating arrangements and policies apply to your request.</p></div><div className="rp-business-feature-grid">{(kind === "corporate" ? ["Employee health service enquiries", "On-site collection planning", "Organization-level coordination", "Service and pricing review"] : kind === "doctors" ? ["Published test information", "Patient booking guidance", "Collection coordination", "Report access safeguards"] : ["Service collaboration", "Local collection coordination", "Organization enquiries", "Terms and authority review"]).map((item, index) => <article key={item}><b>{["01", "02", "03", "04"][index]}</b><strong>{item}</strong><span>Discussed and verified with Rudra staff</span></article>)}</div></section>
    <section className="rp-business-portal"><div><span className="r-eyebrow">SECURE COORDINATION</span><h2>Clear follow-up from the Rudra team</h2><p>Business, doctor and partner portal features are not currently enabled on this public website. Enquiry details are reviewed through the existing Rudra workflow; no partner dashboard, referral list or report access is simulated here.</p><Link className="text-link" href="/contact">Ask about enquiry follow-up →</Link></div><aside><div className="rp-portal-brand">RUDRA <small>ENQUIRY SUPPORT</small></div><div><b>Enquiry workspace</b><span>Available after staff review</span></div><ul><li>Enquiry status <b>Not connected</b></li><li>Documents <b>Not enabled</b></li><li>Patient records <b>Restricted</b></li><li>Next steps <b>Contact from Rudra</b></li></ul><small>Illustrative interface preview · no account or data shown</small></aside></section>
    <section className="ref-business-services"><div><span className="eyebrow">Current catalogue</span><h2>Browse published diagnostic services</h2><p>Only currently published catalogue items appear in the directory. A listing does not confirm eligibility, local availability or appointment times.</p><div className="ref-actions"><Link className="button button-secondary" href="/tests">Diagnostic tests →</Link><Link className="button button-secondary" href="/packages">Health packages →</Link><Link className="button button-secondary" href="/centres">Find centres →</Link></div></div><div className="ref-business-privacy"><strong>Privacy and review</strong><p>Do not submit patient identifiers, reports or medical history through this form. Rudra does not enroll you in marketing or confirm any service from an enquiry.</p></div></section>
    <section className="rp-business-faq"><div><span className="r-eyebrow">BEFORE YOU ENQUIRE</span><h2>Frequently asked questions</h2><p>General information for organizations and healthcare professionals.</p></div><div><details><summary>Does submitting this form create an agreement?</summary><p>No. It sends an enquiry for Rudra staff review. A separate written approval is required for any arrangement.</p></details><details><summary>Can this form be used to share patient details?</summary><p>No. Do not send patient names, phone numbers, reports or medical history through a general enquiry.</p></details><details><summary>Are pricing and availability confirmed here?</summary><p>No. Rudra staff will confirm currently approved services and terms during follow-up.</p></details></div></section>
    <section className="ref-business-form" id="business-enquiry"><div><span className="eyebrow">CONTACT THE RUDRA TEAM</span><h2>{page.contact}</h2><p>Share your enquiry for staff review. Submission does not create an agreement, booking or service commitment.</p></div><PublicEnquiryForm topic={kind === "doctors" ? "DOCTOR" : kind === "corporate" ? "CORPORATE" : "PARTNER"}/></section>
  </main>;
}
