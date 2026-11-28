import Link from "next/link";

const screens = [
  ["A001", "Website service guide", "/chat"],
  ["A002", "WhatsApp configuration", "/communications/whatsapp"],
  ["A003", "Voice configuration", "/communications/voice"],
  ["A004", "Unified inbox", "/communications/inbox"],
  ["A005", "Conversation detail", "/communications/inbox"],
  ["A006", "Support queue", "/support/tickets"],
  ["A007", "Ticket resolution", "/support/tickets"],
  ["A008", "Knowledge library", "/ai/knowledge"],
  ["A009", "AI quality review", "/ai/reviews"],
  ["A010", "Outbound preparation", "/communications/outbound"],
  ["A011", "Call activity", "/communications/calls"],
  ["A012", "Contact recovery", "/communications/recovery"],
  ["A013", "Notification templates", "/communications/notifications"],
] as const;

export function Phase08RouteNavigation({ current }: { current: string }) {
  return <nav className="page-actions" aria-label="Phase 08 communications screens">
    {screens.filter(([id]) => id !== current).map(([id, name, href]) => <Link className="button button-secondary" href={href} key={id}>{id} {name}</Link>)}
  </nav>;
}

export function Phase08CapabilityBoundary({ title, state, children }: { title: string; state: string; children: React.ReactNode }) {
  return <section className="admin-card" aria-label={title}>
    <p className="eyebrow">Phase 08 · {state}</p>
    <h2>{title}</h2>
    {children}
  </section>;
}

export function ProviderDisabledNotice({ provider }: { provider: "WhatsApp" | "voice" }) {
  const channel = provider === "WhatsApp" ? "WhatsApp" : "telephony / AI voice";
  return <Phase08CapabilityBoundary title={`${channel} provider configuration`} state="Not connected · delivery disabled">
    <p>No verified provider configuration is available in this environment. Provider credentials, numbers, webhooks, message/call delivery, recordings and activation controls are not exposed or persisted here.</p>
    <ul>
      <li>Internal workflow previews cannot establish a real connection.</li>
      <li>Consent, approved scripts/templates, quiet hours, routing and human escalation must be reviewed before activation.</li>
      <li>No message or call can be sent from this page.</li>
    </ul>
  </Phase08CapabilityBoundary>;
}
