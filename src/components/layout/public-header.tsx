"use client";

import Link from "next/link";
import { useState } from "react";

const links = [
  ["Centres", "/centres"],
  ["Tests", "/tests"],
  ["Packages", "/packages"],
  ["Service guide", "/chat"],
  ["Home collection", "/home-collection"],
  ["For organizations", "/corporate"],
  ["Contact", "/contact"],
] as const;

export function PublicHeader() {
  const [open, setOpen] = useState(false);
  return (
    <header className="site-header">
      <div className="header-inner">
        <Link className="brand" href="/" aria-label="Rudra Health Care Centre home" onClick={() => setOpen(false)}>
          <span className="brand-mark" aria-hidden="true">r<span>+</span></span>
          <span className="brand-copy"><strong>Rudra</strong><small>HEALTH CARE CENTRE</small></span>
        </Link>
        <button className="menu-toggle" type="button" aria-expanded={open} aria-controls="primary-navigation" onClick={() => setOpen(!open)}>
          <span className="sr-only">{open ? "Close" : "Open"} navigation menu</span>
          <span aria-hidden="true">{open ? "×" : "☰"}</span>
        </button>
        <nav id="primary-navigation" className={`primary-nav${open ? " is-open" : ""}`} aria-label="Main navigation" onKeyDown={(event) => { if (event.key === "Escape") setOpen(false); }}>
          {links.map(([label, href]) => <Link key={href} href={href} onClick={() => setOpen(false)}>{label}</Link>)}
          <Link className="nav-book" href="/book" onClick={() => setOpen(false)}>Request a visit</Link>
          <Link className="nav-account" href="/account" onClick={() => setOpen(false)}>Patient account status <span aria-hidden="true">↗</span></Link>
        </nav>
      </div>
    </header>
  );
}
