"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";

import { PublicFeaturedServices } from "@/components/catalogue/public-featured-services";
import { PublicCentresDirectory } from "@/components/centres/public-centres-directory";

function Eyebrow({ children }: { children: ReactNode }) { return <span className="r-eyebrow">{children}</span>; }
function Icon({ children }: { children: ReactNode }) { return <span className="r-icon" aria-hidden="true">{children}</span>; }
function ButtonLink({ href, children, secondary = false }: { href: string; children: ReactNode; secondary?: boolean }) { return <Link className={`r-button${secondary ? " r-button-outline" : ""}`} href={href}>{children}</Link>; }

function PartnerCard({ compact = false }: { compact?: boolean }) {
  return <aside className={`r-partner${compact ? " is-compact" : ""}`}><small>Rudra service information</small><strong className="r-metropolis">Rudra Health Care Centre</strong><small className="r-pathology">Clear, centre-reviewed next steps</small><ul><li>Only verified catalogue details are shown</li><li>Partner and accreditation claims require authorization</li><li>Centre confirms service availability</li></ul></aside>;
}

function Hero({ kind, title, subtitle, image = "/images/family-care-hero.webp", children }: { kind?: string; title: string; subtitle: string; image?: string; children?: React.ReactNode }) {
  return <section className={`r-hero ${kind ?? ""}`}><div className="r-hero-image"><Image src={image} alt="" fill priority sizes="(max-width: 720px) 100vw, 42vw"/></div><div className="r-hero-copy"><Eyebrow>Rudra Health Care Centre</Eyebrow><h1>{title}</h1><p className="r-hero-subtitle">{subtitle}</p>{children}</div><PartnerCard/></section>;
}

function DemoSearch({ packages = false }: { packages?: boolean }) {
  const [query, setQuery] = useState("");
  return <form className="r-search" action={packages ? "/packages" : "/tests"}><label className="r-sr-only" htmlFor={packages ? "package-search" : "test-search"}>Search {packages ? "packages" : "tests"}</label><span aria-hidden="true">⌕</span><input id={packages ? "package-search" : "test-search"} value={query} onChange={(e) => setQuery(e.target.value)} name="q" placeholder={packages ? "Search packages (e.g. Full Body, Diabetes, Thyroid…)" : "Search tests (e.g. CBC, HbA1c, Thyroid…)"}/><button type="submit">Search {packages ? "packages" : "tests"}</button></form>;
}

export function RudraHomePage() {
  return <div className="r-public"><Hero kind="home-hero" title="Diagnostic Care, With Clear Next Steps" subtitle="Explore currently published services, centre information and reviewed visit requests."><div className="r-trust-row"><span>Published catalogue information</span><span>Centre details where approved</span><span>Requests reviewed by Rudra staff</span></div><div className="r-button-row"><ButtonLink href="/tests">Browse diagnostic tests</ButtonLink><ButtonLink href="/book" secondary>Request a service</ButtonLink></div></Hero>
    <div className="r-home-search"><nav>{[["Tests", "/tests"], ["Packages", "/packages"], ["Request a service", "/book"], ["Track request", "/track"]].map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}</nav><DemoSearch/></div>
    <section className="r-feature-links">{[["⚗", "Diagnostic Tests", "Browse currently published services", "/tests"], ["♧", "Health Packages", "Review published package details", "/packages"], ["⌂", "Home Collection", "Request centre review", "/home-collection"], ["▣", "Corporate Health", "Send a business enquiry", "/corporate"], ["⌖", "Find Centres", "View approved location details", "/centres"], ["▤", "Reports & Tracking", "See current access restrictions", "/track"]].map(([icon, title, copy, href]) => <Link href={href} className="r-feature-tile" key={title}><Icon>{icon}</Icon><b>{title}</b><small>{copy}</small></Link>)}</section>
    <section className="r-content-section"><header className="r-section-head"><div><Eyebrow>Current published services</Eyebrow><h2>Tests and packages</h2><p>Only published, verified and effective catalogue entries appear here.</p></div><ButtonLink href="/packages" secondary>Browse packages →</ButtonLink></header><PublicFeaturedServices/></section>
    <section className="r-home-collection"><div className="r-collection-photo"><Image src="/images/home-collection-visit.webp" alt="Illustrative home collection visit" fill sizes="38vw"/></div><div className="r-collection-copy"><Eyebrow>Home sample collection</Eyebrow><h2>Ask about a visit at home</h2><p>Send a request for an authorized Rudra centre to review. Coverage, timing and any separate service charge are confirmed before a visit is accepted.</p><div className="r-trust-row"><span>Centre review required</span><span>Charges disclosed separately</span><span>No slot is reserved</span></div><ButtonLink href="/home-collection">Home collection information →</ButtonLink></div><aside><Icon>⌂</Icon><b>Check published service areas</b><p>Coverage details appear only when authorized staff publish them.</p><ButtonLink href="/service-areas" secondary>Search service areas</ButtonLink></aside></section>
    <section className="r-offer"><div><Eyebrow>Published catalogue</Eyebrow><h2>Review current package prices</h2><p>Promotional terms are displayed only after Rudra approves and publishes them.</p></div><ButtonLink href="/offers" secondary>View published packages →</ButtonLink></section>
    <section className="r-content-section"><header className="r-section-head"><div><Eyebrow>Our centres</Eyebrow><h2>Find a published Rudra centre</h2><p>Location and service information is shown only when approved for public viewing.</p></div><ButtonLink href="/centres" secondary>View all centres →</ButtonLink></header><PublicCentresDirectory/></section></div>;
}
export function RudraAboutPage() {
  return <div className="r-public"><Hero kind="about-hero" title="About Rudra Health Care Centre" subtitle="Rudra is the public service brand for diagnostic information, centre support and reviewed service requests." image="/images/family-care-hero.webp"><div className="r-button-row"><ButtonLink href="/tests">Browse published services</ButtonLink><ButtonLink href="/contact" secondary>Contact Rudra</ButtonLink></div></Hero>
    <section className="r-about-intro"><div className="r-about-building"><Image src="/images/diagnostics-lab-banner.webp" alt="Illustrative diagnostic laboratory interior" fill sizes="40vw"/></div><div><Eyebrow>Our role</Eyebrow><h2>Clear service information, with centre review</h2><p>Rudra Health Care Centre publishes diagnostic service and location information when the source, price and public details have been reviewed.</p><p>A catalogue listing or submitted request does not confirm an appointment, laboratory order or report release. The selected centre reviews each request and confirms any next step.</p><div className="r-callout"><Icon>♧</Icon><span><b>Your health information stays within its authorized purpose.</b><small>Use public forms only for basic contact and service requests.</small></span></div></div></section>
    <section className="r-about-cards">{[["◎", "Published information", "Current service and centre details appear only after authorized review."], ["◉", "Staff-reviewed requests", "A public request enters a Rudra workflow for staff review."], ["◇", "Privacy boundaries", "Patient sign-in and report access remain disabled until identity safeguards are approved."]].map(([icon, title, copy])=><article key={title}><Icon>{icon}</Icon><div><b>{title}</b><p>{copy}</p></div></article>)}</section>
    <section className="r-partnership"><div><Eyebrow>Laboratory relationship</Eyebrow><h2>Rudra and Metropolis Healthcare</h2><p>Rudra Health Care Centre is the customer-facing service brand. Metropolis Healthcare is the diagnostic franchise/laboratory partner. Public claims about accreditation, service scope, prices or legal terms are displayed only when authorized and verified.</p></div><PartnerCard compact/></section>
    <section className="r-content-section"><h2>Explore Rudra services</h2><div className="r-feature-links">{[["⚗","Diagnostic Tests","/tests"],["♧","Health Packages","/packages"],["⌂","Home Collection","/home-collection"],["▣","Patient Support","/contact"]].map(([icon,label,href])=><Link key={label} href={href} className="r-feature-tile"><Icon>{icon}</Icon><b>{label}</b><small>View information →</small></Link>)}</div></section></div>;
}
