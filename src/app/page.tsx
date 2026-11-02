import Link from "next/link";
import { ActionButton } from "@/components/ui/action-button";
import { PublicContentOverride } from "@/components/website/public-content-override";
import { PublicServiceAssistant } from "@/components/public/public-service-assistant";
import { getPublishedWebsiteMetadata } from "@/server/public-website-content";

export async function generateMetadata() { return getPublishedWebsiteMetadata("home", { title: "Rudra Health Care Centre | Care, clearly connected", description: "A new, connected home for Rudra Health Care Centre services and patient care." }); }

const services = [
  { icon: "⌕", title: "Explore tests", description: "Browse diagnostic services and find the right next step.", href: "/tests" },
  { icon: "✳", title: "Health packages", description: "See the package catalogue as it becomes available.", href: "/packages" },
  { icon: "⌂", title: "Home collection", description: "Booking access is being prepared for a thoughtful, reliable visit.", href: "/book" },
];

export default function Home() {
  return <><PublicContentOverride slug="home" fallback={<>
    <section className="hero"><div className="hero-inner">
      <div className="hero-copy"><span className="eyebrow">Your health, in caring hands</span><h1>Care that feels close. Health services that feel clear.</h1><p>Rudra Health Care Centre brings diagnostic services and personal care together, with a team that is here to guide your next step.</p>
        <div className="actions"><ActionButton href="/tests">Explore tests</ActionButton><ActionButton href="/book" variant="secondary">How booking works</ActionButton></div>
        <div className="trust-line"><span aria-hidden="true" /> A new, connected care experience is taking shape</div>
      </div>
      <div className="hero-art" aria-label="Illustration representing connected, attentive care" role="img"><div className="art-orbit"/><div className="care-card"><span className="care-symbol" aria-hidden="true">✳</span><small>CARE, WITH CLARITY</small></div><div className="float-note note-one"><strong>Here for your next step</strong>Support that stays personal</div><div className="float-note note-two"><span className="note-dot"/>Rudra Health Care Centre</div></div>
    </div></section>
    <section className="section"><div className="section-heading"><div><span className="eyebrow">Start here</span><h2>Find the care you need</h2></div><Link className="text-link" href="/book">Visit booking guide <span aria-hidden="true">→</span></Link></div>
      <div className="service-grid">{services.map((service) => <Link href={service.href} key={service.title} className="service-card"><span className="service-icon" aria-hidden="true">{service.icon}</span><strong>{service.title}</strong><p>{service.description}</p><span className="arrow" aria-hidden="true">↗</span></Link>)}</div>
    </section>
    <section className="feature-band"><div className="feature-inner"><div className="feature-copy"><span className="eyebrow">A more connected experience</span><h2>Good care starts with knowing what comes next.</h2><p>We are building one simple place for people to explore services, plan a visit and stay connected with the care team.</p><ActionButton href="/account" variant="secondary">Patient account status</ActionButton></div><div className="values"><div className="value"><strong>People first</strong><span>Personal guidance at every step.</span></div><div className="value"><strong>Clear next steps</strong><span>Useful information, without the guesswork.</span></div><div className="value"><strong>Care that connects</strong><span>One Rudra experience for your care journey.</span></div><div className="value"><strong>Support when needed</strong><span>Our team is here to help.</span></div></div></div></section>
  </>} /><div className="section"><PublicServiceAssistant /></div></>;
}
