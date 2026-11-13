"use client";

import Link from "next/link";
import { useState } from "react";

const links = [
  ["Home", "/"], ["Tests", "/tests"], ["Packages", "/packages"],
  ["Home Collection", "/home-collection"], ["Find Centres", "/centres"],
  ["Track request", "/track"], ["Report access", "/report-access"], ["Health guides", "/health-guides"], ["Contact", "/contact"],
] as const;

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  return <header className="site-header r-site-header"><div className="header-inner">
    <Link className="brand" href="/" aria-label="Rudra Health Care Centre home" onClick={() => setOpen(false)}>
      <span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M24 42 7.5 27.2C-2.7 16.3 12.5 3.1 24 13.4 35.5 3.1 50.7 16.3 40.5 27.2L24 42Z"/><path d="M21 15h6v7h7v6h-7v7h-6v-7h-7v-6h7z"/></svg></span>
      <span className="brand-copy"><strong>RUDRA</strong><small>HEALTH CARE CENTRE</small><small className="brand-tagline">Your Health · Our Priority</small></span>
    </Link>
    <button className="menu-toggle" type="button" aria-expanded={open} aria-controls="primary-navigation" onClick={() => setOpen(!open)}><span className="sr-only">{open ? "Close" : "Open"} navigation menu</span><span aria-hidden="true">{open ? "×" : "☰"}</span></button>
    <nav id="primary-navigation" className={`primary-nav${open ? " is-open" : ""}`} aria-label="Main navigation" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
      {links.map(([label, href]) => <Link key={href} href={href} onClick={() => setOpen(false)}>{label}</Link>)}
      <Link className="nav-search" href="/tests" aria-label="Search tests and packages" onClick={() => setOpen(false)}>⌕</Link>
      <Link className="nav-account" href="/login" onClick={() => setOpen(false)}>♙ &nbsp;Patient access</Link>
      <Link className="nav-book" href="/book" onClick={() => setOpen(false)}>▦ &nbsp;Book Now</Link>
    </nav>
  </div></header>;
}
