import Link from "next/link";

export function PublicFooter() {
  return <footer className="site-footer"><div className="footer-inner">
    <div><Link className="footer-brand" href="/">Rudra Health Care Centre</Link><p>Thoughtful diagnostics, with care at every step.</p></div>
    <nav aria-label="Footer navigation"><Link href="/about">About</Link><Link href="/centres">Centres</Link><Link href="/service-areas">Service areas</Link><Link href="/tests">Tests</Link><Link href="/packages">Packages</Link><Link href="/chat">Service guide</Link><Link href="/home-collection">Home collection</Link><Link href="/corporate">Organizations</Link><Link href="/doctors">Doctors</Link><Link href="/partners">Partners</Link><Link href="/faq">FAQ</Link><Link href="/contact">Contact</Link><Link href="/book">Request a visit</Link><Link href="/account">Patient account status</Link><Link href="/staff">Staff</Link></nav>
    <small>© Rudra Health Care Centre</small>
  </div></footer>;
}
