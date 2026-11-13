"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";
import { PATIENT_PORTAL_GATE_NOTICE, PATIENT_PORTAL_SYNTHETIC_SCENARIOS, type PatientPortalScreenId } from "@/lib/patient-portal-preview-data";

export type PortalView = "dashboard" | "profile" | "family" | "member" | "notifications" | "support" | "calendar" | "addresses" | "billing" | "reports" | "orders" | "reschedule" | "bookings" | "journey" | "appointments" | "appointment-change" | "documents" | "trends";

const nav = [
  ["P001", "Home", "/account"], ["P002", "Profile & identity", "/account/profile"],
  ["P003", "Family", "/account/family"], ["P004", "Member access", "/account/family/synthetic-preview"],
  ["P005", "Care journey", "/account/orders/synthetic-preview/journey"], ["P006", "Appointments", "/account/appointments"],
  ["P007", "Change request", "/account/appointments/synthetic-preview/change"], ["P008", "Orders & samples", "/account/orders"],
  ["P009", "Reports", "/account/reports"], ["P010", "Bills & payments", "/account/billing"],
  ["P011", "Addresses", "/account/addresses"], ["P012", "Calendar", "/account/calendar"],
  ["P013", "Support", "/account/support"], ["P014", "Notifications", "/account/notifications"],
  ["P015", "Document vault", "/account/health-documents"], ["P016", "Health trends", "/account/health-trends"],
] as const;

const viewDetails: Record<PortalView, { id: PatientPortalScreenId; title: string; subtitle: string; description: string }> = {
  dashboard: { id: "P001", title: "Patient home / health overview", subtitle: "Your care, in one place", description: "A private overview of appointments, orders and reports after patient access is approved." },
  profile: { id: "P002", title: "My profile & identity", subtitle: "Manage your profile securely", description: "Identity verification and protected profile changes are not enabled in this preview." },
  family: { id: "P003", title: "Family dashboard", subtitle: "Your family, with clear permissions", description: "A family relationship alone never grants access to another person’s records." },
  member: { id: "P004", title: "Member 360 & access management", subtitle: "Access must be explicit and revocable", description: "Each person’s identity, consent, scope and expiry must be verified separately." },
  journey: { id: "P005", title: "Order care-journey timeline", subtitle: "See only verified milestones", description: "Operational events are displayed only after they are recorded and authorized." },
  appointments: { id: "P006", title: "My bookings & appointments", subtitle: "Manage confirmed appointments", description: "An enquiry or request does not reserve a visit or collection slot." },
  "appointment-change": { id: "P007", title: "Reschedule / cancel request", subtitle: "Change a verified appointment", description: "No appointment can be changed until an authorized patient workflow is approved." },
  bookings: { id: "P006", title: "My bookings & appointments", subtitle: "Manage confirmed appointments", description: "An enquiry or request does not reserve a visit or collection slot." },
  orders: { id: "P008", title: "Orders & sample history", subtitle: "Follow verified order updates", description: "Laboratory progress is never inferred or invented." },
  reports: { id: "P009", title: "My medical reports & sharing", subtitle: "Your health information stays private", description: "Reports require verified patient identity, an authorized release, and a separate sharing permission." },
  billing: { id: "P010", title: "Bills, receipts & payment history", subtitle: "A clear view of verified charges", description: "Billing records and payment actions are not available in this preview." },
  addresses: { id: "P011", title: "Addresses & collection preferences", subtitle: "Manage details securely", description: "Address collection and serviceability checks require an approved patient workflow." },
  calendar: { id: "P012", title: "Health calendar & reminders", subtitle: "Keep track of verified appointments", description: "Only confirmed events and approved reminders can appear here." },
  support: { id: "P013", title: "Help, complaints & support tickets", subtitle: "Get help from Rudra", description: "Patient support ticket access is not enabled; no message will be sent from this preview." },
  notifications: { id: "P014", title: "Notifications and channel preferences", subtitle: "Stay informed on your terms", description: "No notification provider is connected to this preview." },
  documents: { id: "P015", title: "Document vault / health passport", subtitle: "Keep documents protected", description: "Upload, scanning, encrypted storage and sharing remain gated." },
  trends: { id: "P016", title: "Comparable health trends", subtitle: "Review results with clinical context", description: "No clinical values or comparisons are available in this preview." },
  reschedule: { id: "P007", title: "Reschedule / cancel request", subtitle: "Change a verified appointment", description: "No appointment can be changed until an authorized patient workflow is approved." },
};

const statLabels: Partial<Record<PortalView, string[]>> = {
  dashboard: ["Appointments", "Orders", "Reports", "Family access"],
  notifications: ["Notifications", "Appointments", "Reports", "Security"],
  support: ["Open requests", "In progress", "Resolved", "Closed"],
  calendar: ["Appointments", "Home collection", "Follow-ups", "Reminders"],
  addresses: ["Saved addresses", "Verified locations", "Collection area", "Preferences"],
  billing: ["Bills", "Payments", "Outstanding", "Refunds"],
  reports: ["Reports", "Processing", "Pending verification", "Restricted"],
  orders: ["Orders", "Processing", "Completed", "Exceptions"],
  appointments: ["All appointments", "Upcoming", "Past", "Change requests"],
  bookings: ["All appointments", "Upcoming", "Past", "Change requests"],
  documents: ["Files", "Pending scan", "Shared", "Restricted"],
  trends: ["Measures", "Comparable", "Needs review", "Unavailable"],
};

function EmptyPortalCard({ title, children }: { title: string; children: ReactNode }) {
  return <section className="pt-card"><h2>{title}</h2><div>{children}</div></section>;
}

function PreviewScenario({ id }: { id: PatientPortalScreenId }) {
  return <section className="pt-card pt-synthetic-card" aria-labelledby="pt-synthetic-heading">
    <div className="pt-synthetic-title"><span aria-hidden="true">◇</span><div><strong id="pt-synthetic-heading">Synthetic workflow example</strong><small>Fictional interface scenario only · not a Rudra record</small></div></div>
    <ul>{PATIENT_PORTAL_SYNTHETIC_SCENARIOS[id].map((line) => <li key={line}>{line}</li>)}</ul>
    <p className="pt-no-write">This preview is held in page memory only. It sends no request, stores no personal data, and does not alter operational records.</p>
  </section>;
}

function ViewContent({ view }: { view: PortalView }) {
  switch (view) {
    case "dashboard": return <><EmptyPortalCard title="Your next steps"><p>Once patient access is approved, this area can show verified appointments and submitted enquiry follow-up.</p><Link href="/book">Read about visit requests →</Link></EmptyPortalCard><EmptyPortalCard title="Orders, reports and family"><p>Order history, released reports and explicitly authorized family access require separate identity and permission checks.</p><Link href="/report-access">Report access information →</Link></EmptyPortalCard></>;
    case "profile": return <><EmptyPortalCard title="Personal details"><p>Profile fields are not loaded. Do not enter personal details here; patient sign-in and identity verification are not enabled.</p></EmptyPortalCard><EmptyPortalCard title="Identity & preferences"><p>Contact verification, profile updates and privacy preferences must be tied to a verified identity and an audited workflow.</p></EmptyPortalCard></>;
    case "family": return <><EmptyPortalCard title="Family relationships"><p>No family profiles are displayed. Linking requires verified identities and documented relationship authority.</p><Link href="/contact">Ask Rudra about family access →</Link></EmptyPortalCard><EmptyPortalCard title="Sharing requests"><p>There are no active grants. Relationship status does not grant appointment, report, billing or order access.</p></EmptyPortalCard></>;
    case "member": return <><EmptyPortalCard title="Member profile"><p>No member identity or contact information is loaded.</p></EmptyPortalCard><EmptyPortalCard title="Access scope"><p>No data scope is active. Adult patients must authorize their own access; guardian authority needs documented verification.</p><p>Grant creation, renewal and revocation are disabled until patient identity and consent gates are approved.</p></EmptyPortalCard></>;
    case "journey": return <><EmptyPortalCard title="Journey event status"><p>No order events are loaded. Metropolis receipt, processing, collection and report release remain unverified unless recorded by an authorized workflow.</p></EmptyPortalCard><EmptyPortalCard title="Need help?"><p>Use general support without including medical details.</p><Link href="/account/support">Support preview →</Link></EmptyPortalCard></>;
    case "appointments": case "bookings": return <><EmptyPortalCard title="Confirmed appointments"><p>No patient appointment records or available slots are loaded. A public enquiry does not create an appointment.</p><Link href="/book">Read about visit requests →</Link></EmptyPortalCard><EmptyPortalCard title="Appointment actions"><p>Reschedule and cancellation requests need an authenticated patient, current appointment and approved policy.</p><Link href="/account/appointments/synthetic-preview/change">View change-request preview →</Link></EmptyPortalCard></>;
    case "appointment-change": case "reschedule": return <><EmptyPortalCard title="Appointment to change"><p>No verified appointment is selected. A change request cannot be submitted.</p></EmptyPortalCard><EmptyPortalCard title="Change policy"><p>Availability, refund terms and appointment transitions require an approved patient workflow and current server-side checks.</p><button className="r-button" disabled type="button" aria-describedby="pt-change-disabled">Request unavailable</button><small id="pt-change-disabled">No appointment is selected and patient access is disabled.</small></EmptyPortalCard></>;
    case "orders": return <><EmptyPortalCard title="Orders and samples"><p>No patient order or specimen records are loaded.</p></EmptyPortalCard><EmptyPortalCard title="External laboratory milestones"><p>Metropolis receipt: not recorded. Processing: unverified. Collection: not verified. No external integration is asserted.</p></EmptyPortalCard></>;
    case "reports": return <><EmptyPortalCard title="Released reports"><p>No report or clinical result is included. Preview, download and report sharing are unavailable.</p></EmptyPortalCard><EmptyPortalCard title="Sharing controls"><p>Sharing requires verified identity, explicit recipient scope, expiry, revocation and release authorization.</p></EmptyPortalCard></>;
    case "billing": return <><EmptyPortalCard title="Bills and payment history"><p>No issuer-approved bill, invoice, receipt, balance or payment record is loaded.</p></EmptyPortalCard><EmptyPortalCard title="Payment actions"><p>Payment and refund actions remain unavailable. No payment provider is connected.</p><Link href="/checkout/example">Payment availability →</Link></EmptyPortalCard></>;
    case "addresses": return <><EmptyPortalCard title="Saved addresses"><p>No home address or collection instruction is requested or stored by this preview.</p><button className="r-button" disabled type="button">Add address unavailable</button></EmptyPortalCard><EmptyPortalCard title="Service area & preferences"><p>No postcode or location check is performed. A published service-area description does not guarantee service, fee or appointment availability.</p></EmptyPortalCard></>;
    case "calendar": return <><EmptyPortalCard title="Health calendar"><div className="pt-calendar-empty" aria-label="Empty calendar illustration">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((day) => <b key={day}>{day}</b>)}{Array.from({length:35},(_, index)=><span key={index} aria-hidden="true" />)}</div><p>No verified appointments are available to display.</p></EmptyPortalCard><EmptyPortalCard title="Reminders"><p>No reminders are scheduled or delivered. Clinician-guided recalls require approved policy.</p></EmptyPortalCard></>;
    case "support": return <><EmptyPortalCard title="Support categories"><div className="pt-chip-row">{["Appointment question", "Home collection", "Report access", "Billing", "Account access", "Feedback"].map((item) => <span key={item}>{item}</span>)}</div></EmptyPortalCard><EmptyPortalCard title="Support requests"><p>No ticket or message is submitted or loaded. Contact Rudra for service help; do not share medical details in a public enquiry.</p><Link className="r-button" href="/contact">Open public contact information</Link></EmptyPortalCard></>;
    case "notifications": return <><EmptyPortalCard title="Notification history"><p>No message or alert was sent or delivered.</p></EmptyPortalCard><EmptyPortalCard title="Channel preferences"><p>SMS, email, WhatsApp and voice preferences are not saved or connected to a provider in this preview.</p></EmptyPortalCard><EmptyPortalCard title="Quiet hours"><p>No schedule is applied.</p></EmptyPortalCard></>;
    case "documents": return <><EmptyPortalCard title="Health documents"><p>No files have been uploaded or stored. File upload is disabled until patient authorization, encrypted storage and malware scanning are qualified.</p><button className="r-button" disabled type="button">Upload unavailable</button></EmptyPortalCard><EmptyPortalCard title="Sharing and provenance"><p>No share link exists. Document provenance, expiry and revocation require an approved patient workflow.</p></EmptyPortalCard></>;
    case "trends": return <><EmptyPortalCard title="Comparable results"><p>No analyte values, reference ranges, result dates or charts are shown.</p></EmptyPortalCard><EmptyPortalCard title="Clinical review"><p>Comparability requires verified released results and clinician-approved rules for units, methods, reference ranges and time periods.</p></EmptyPortalCard></>;
  }
}

export function PatientPortalPreview({ view }: { view: PortalView }) {
  const [showSynthetic, setShowSynthetic] = useState(false);
  const screen = viewDetails[view];
  return <main className={`pt-portal pt-${view}`}>
    <div className="pt-ribbon"><b>Patient access unavailable</b><span>{PATIENT_PORTAL_GATE_NOTICE}</span><Link href="/login">Sign-in information</Link></div>
    <div className="pt-shell">
      <nav className="pt-nav" aria-label="Patient portal screens"><b>RUDRA <small>PATIENT & FAMILY PORTAL</small></b>{nav.map(([id,label,href])=><Link className={screen.id===id?"active":""} aria-current={screen.id===id?"page":undefined} key={id} href={href}><span aria-hidden="true">{id.slice(1)}</span>{label}</Link>)}<span className="pt-nav-state">Access disabled</span></nav>
      <div className="pt-workspace">
        <section className="pt-hero"><div><span className="r-eyebrow">{screen.id} · PATIENT & FAMILY PORTAL</span><h1>{screen.title}</h1><h2>{screen.subtitle}</h2><p>{screen.description}</p><div className="pt-hero-note">SYNTHETIC PREVIEW ONLY · No patient identity, account or personal records are connected.</div></div><aside><span aria-hidden="true">◇</span><b>Private by design</b><small>Patient sign-in and protected data remain disabled pending identity, consent and security approval.</small></aside></section>
        <div className="pt-demo-control"><div><b>Preview the screen flow</b><small>Optional synthetic scenario; no API call, browser storage or database write.</small></div><button className="r-button r-button-outline" type="button" aria-pressed={showSynthetic} onClick={()=>setShowSynthetic((current)=>!current)}>{showSynthetic?"Hide synthetic example":"Show synthetic example"}</button></div>
        {showSynthetic && <PreviewScenario id={screen.id}/>}
        {statLabels[view] && <div className="pt-stat-row">{statLabels[view]!.map((label)=><article key={label}><b>—</b><span>{label}</span><small>No patient account data</small></article>)}</div>}
        <div className="pt-content-grid"><div className="pt-main-column"><ViewContent view={view}/></div><aside className="pt-side-column"><EmptyPortalCard title="Access requirements"><b className="pt-pending">Patient access is disabled</b><p>Identity proofing, account linking, patient consent and a patient authentication policy need approval before protected data can load.</p><Link className="r-button r-button-outline" href="/login">Sign-in information</Link></EmptyPortalCard><EmptyPortalCard title="Need help?"><p>For general service questions, contact Rudra. Do not include medical details in public enquiries.</p><Link className="r-button" href="/contact">Contact Rudra</Link></EmptyPortalCard><div className="pt-safety">Family links never grant medical access automatically. Each patient’s identity, scope, consent and revocation must be checked independently.</div></aside></div>
      </div>
    </div>
  </main>;
}
