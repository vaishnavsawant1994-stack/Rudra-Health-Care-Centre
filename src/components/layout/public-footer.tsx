import Link from "next/link";

export function PublicFooter() {
  return <footer className="site-footer r-site-footer"><div className="footer-inner ref-footer-inner">
    <div className="ref-footer-brand"><Link className="footer-brand" href="/"><span className="brand-mark" aria-hidden="true"><svg viewBox="0 0 48 48"><path d="M24 42 7.5 27.2C-2.7 16.3 12.5 3.1 24 13.4 35.5 3.1 50.7 16.3 40.5 27.2L24 42Z"/><path d="M21 15h6v7h7v6h-7v7h-6v-7h-7v-6h7z"/></svg></span><span><strong>RUDRA</strong><small>HEALTH CARE CENTRE</small></span></Link><p>Patient-focused diagnostic information and considerate support for your next step.</p><small>Rudra Health Care Centre is the patient-facing service brand.</small><div className="r-social-links"><a href="https://www.facebook.com/" aria-label="Facebook">f</a><a href="https://www.instagram.com/" aria-label="Instagram">◎</a><a href="https://www.youtube.com/" aria-label="YouTube">▶</a><a href="https://www.linkedin.com/" aria-label="LinkedIn">in</a></div></div>
    <nav aria-label="Quick links"><strong>Quick Links</strong><Link href="/">Home</Link><Link href="/tests">Tests</Link><Link href="/packages">Packages</Link><Link href="/home-collection">Home Collection</Link><Link href="/centres">Find Centres</Link><Link href="/offers">Offers</Link></nav>
    <nav aria-label="About Rudra"><strong>About Rudra</strong><Link href="/about">Our Story</Link><Link href="/partners">Partner Enquiries</Link><Link href="/corporate">Corporate Services</Link><Link href="/doctors">For Doctors</Link><Link href="/faq">Quality & Accreditations</Link><Link href="/contact">Contact</Link></nav>
    <nav aria-label="Support"><strong>Support</strong><Link href="/contact">Help Centre</Link><Link href="/faq">FAQs</Link><Link href="/book">Book a Test</Link><Link href="/track-booking">Track a Booking</Link><Link href="/report-access">Report Access</Link></nav>
    <nav aria-label="Legal"><strong>Legal</strong><Link href="/information#policy-privacy">Privacy Policy</Link><Link href="/information#policy-terms">Terms & Conditions</Link><Link href="/information#policy-billing-refunds">Refund Policy</Link><Link href="/information#policy-accessibility">Accessibility</Link><Link href="/information">Sitemap</Link></nav>
    <div className="ref-footer-contact"><strong>Contact Us</strong><p>For current phone, email and centre hours, use the centre contact page.</p><Link href="/contact">Contact Rudra →</Link></div>
    <div className="r-footer-partner"><small>In association with</small><b>◇ METROPOLIS</b><small>The Pathology Specialist</small></div>
    <div className="ref-footer-bottom"><small>© 2026 Rudra Health Care Centre. All rights reserved.</small><small>Service, partner and catalogue information is subject to verification.</small></div>
  </div></footer>;
}
