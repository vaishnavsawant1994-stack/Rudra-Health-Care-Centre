import Link from "next/link";

export function Phase10Restricted({ screen, title, reason, dependencies }: { screen: string; title: string; reason: string; dependencies: string[] }) {
  return <section className="admin-card" aria-labelledby={`${screen}-title`}>
    <p className="eyebrow">{screen} · Restricted capability</p>
    <h2 id={`${screen}-title`}>{title}</h2>
    <p>{reason}</p>
    <h3>Required before activation</h3>
    <ul>{dependencies.map((dependency) => <li key={dependency}>{dependency}</li>)}</ul>
    <p>There is no synthetic operational record behind this screen. No stock, incident, training, appointment capacity, provider event or payment is asserted.</p>
    <p><Link href="/actions">Review authorized work items</Link></p>
  </section>;
}
