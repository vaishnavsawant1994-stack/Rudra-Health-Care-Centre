import Link from "next/link";

type AccessKind = "tracking" | "reports" | "login" | "register";

const pageCopy: Record<AccessKind, { eyebrow: string; title: string; subtitle: string; description: string; prompt: string; placeholder: string; action: string; icon: string }> = {
  tracking: { eyebrow: "BOOKING UPDATES", title: "Track your test or booking", subtitle: "Clear updates, when they are verified.", description: "Enter a Rudra booking reference to request an update. Public tracking is not connected yet, so this page will not display or invent booking details.", prompt: "Booking or order reference", placeholder: "Enter your Rudra reference", action: "Check tracking availability", icon: "↗" },
  reports: { eyebrow: "REPORT ACCESS", title: "Access your diagnostic reports", subtitle: "Your health information stays private.", description: "Report access requires patient identity verification and an authorized report release. Secure patient self-service is not enabled yet.", prompt: "Booking or report reference", placeholder: "Enter your Rudra reference", action: "Check report access", icon: "▤" },
  login: { eyebrow: "PATIENT ACCESS", title: "Welcome back to Rudra", subtitle: "Your health, always with you.", description: "Patient sign-in is not enabled while Rudra finalizes its identity verification and account security process.", prompt: "Registered mobile number", placeholder: "+91 00000 00000", action: "Patient sign-in is unavailable", icon: "♙" },
  register: { eyebrow: "CREATE AN ACCOUNT", title: "Create your Rudra patient account", subtitle: "Simple. Secure. Always with you.", description: "Patient registration is not enabled yet. Rudra will open account creation after its identity, consent and family-access safeguards are approved.", prompt: "Full name", placeholder: "Patient accounts are not open", action: "Registration is unavailable", icon: "＋" },
};

function AccessPanel({ kind }: { kind: AccessKind }) {
  const copy = pageCopy[kind];
  const patientAccount = kind === "login" || kind === "register";
  return <main className={`rp-access rp-access-${kind}`}>
    <section className="rp-access-hero">
      <div className="rp-access-copy"><span className="r-eyebrow">{copy.eyebrow}</span><h1>{copy.title}</h1><h2>{copy.subtitle}</h2><p>{copy.description}</p><div className="rp-access-points"><span><b>✓</b> Privacy first</span><span><b>✓</b> Verified information</span><span><b>✓</b> Rudra support</span></div></div>
      <div className="rp-access-photo" role="img" aria-label="Illustrative Rudra patient support"/>
      <aside className="rp-access-side"><span aria-hidden="true">{copy.icon}</span><h2>{patientAccount ? "Your health, protected" : kind === "reports" ? "Your reports are private" : "Updates from verified events"}</h2><p>{patientAccount ? "Personal health records require secure identity checks and consent." : "Information appears only after an authorized Rudra team member records it."}</p></aside>
    </section>
    <div className="rp-access-layout">
      <section className="rp-panel rp-access-form">
        <div className="rp-heading"><h2>{patientAccount ? "Patient account access" : kind === "reports" ? "Verify report access" : "Find a booking"}</h2><span>{patientAccount ? "UNAVAILABLE" : "PREVIEW"}</span></div>
        <p>{patientAccount ? "This secure patient service is not active." : "Lookup is not connected to a live booking or report service."}</p>
        <label>{copy.prompt}<input disabled placeholder={copy.placeholder} aria-describedby="access-state"/></label>
        {!patientAccount && <label>Registered mobile number<input disabled placeholder="Used only after identity verification is available"/></label>}
        <button className="r-button" type="button" disabled>{copy.action} →</button>
        <div id="access-state" className="rp-access-alert" role="status"><b>Unavailable for now</b><span>{patientAccount ? "Do not enter personal or medical information here. For assistance, contact Rudra directly." : "No booking, patient or report data is being looked up or shown on this page."}</span></div>
        <small>Do not share OTPs, report files or sensitive medical information through an unverified channel.</small>
      </section>
      <section className="rp-access-explainer">
        <article className="rp-panel"><h2>{patientAccount ? "Before patient accounts open" : kind === "reports" ? "How report access will work" : "How booking tracking will work"}</h2><ol>{(patientAccount ? ["Rudra approves identity checks", "You review consent and privacy choices", "Only authorized records appear"] : kind === "reports" ? ["Provide a booking reference", "Verify your identity securely", "View reports released by authorized staff"] : ["Enter your booking reference", "Verify your identity if required", "See updates recorded by the Rudra team"]).map((step, index) => <li key={step}><b>{index + 1}</b><span>{step}</span></li>)}</ol><p className="rp-access-note">{kind === "reports" ? "A report is never made available solely because someone knows a booking reference." : "A family relationship by itself does not grant access to another adult’s records."}</p></article>
        <article className="rp-panel"><h2>Need help?</h2><p>Contact Rudra for general service questions. Please do not send patient identifiers or report contents through a public enquiry.</p><div className="ref-actions"><Link className="button button-secondary" href="/contact">Contact Rudra</Link><Link className="button button-secondary" href="/faq">Frequently asked questions</Link>{kind === "login" && <Link className="button button-secondary" href="/register">Registration information</Link>}{kind === "register" && <Link className="button button-secondary" href="/login">Sign-in information</Link>}</div></article>
      </section>
    </div>
  </main>;
}

export function RudraAccessPage({ kind }: { kind: AccessKind }) { return <AccessPanel kind={kind}/>; }
