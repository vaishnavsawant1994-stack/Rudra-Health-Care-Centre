import Link from "next/link";

export const metadata = {
  title: "Online payment unavailable | Rudra Health Care Centre",
  robots: { index: false, follow: false },
};

export default function PublicCheckoutPage() {
  return <main className="rc-content-page" aria-labelledby="payment-unavailable-title">
    <section className="rc-policy-draft" role="status"><b>Online payment is unavailable</b><span>Rudra has not enabled a payment provider or approved billing policy. No payment has been started, captured or confirmed.</span></section>
    <section className="rc-content-hero"><div><span className="r-eyebrow">PAYMENT CHECKOUT</span><h1 id="payment-unavailable-title">Payment cannot be completed here</h1><p>A booking request is reviewed by the selected centre. An enquiry or checkout link does not create an appointment, invoice or payment receipt.</p><div className="ref-actions"><Link className="r-button" href="/contact">Contact Rudra</Link><Link className="button button-secondary" href="/book">Return to service request</Link></div></div></section>
  </main>;
}
