import Link from "next/link";

const receiptIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function PublicEnquiryReceipt({ receiptId }: { receiptId: string }) {
  const validReceiptId = receiptIdPattern.test(receiptId);
  const safeReceiptId = validReceiptId ? receiptId.toUpperCase() : null;

  return <main className="r-public r-booking-page">
    <div className="r-demo-note"><b>Enquiry acknowledgement only</b><span>This page never loads enquiry details, appointment records, collection slots or payment information.</span></div>
    <section className="r-confirmation" aria-labelledby="receipt-title">
      <div className="r-confirmation-hero">
        <div className="r-check-circle" aria-hidden="true">{safeReceiptId ? "✓" : "!"}</div>
        <div>
          <h1 id="receipt-title">{safeReceiptId ? "Enquiry received for staff review" : "Receipt reference unavailable"}</h1>
          <h2>This is not an appointment confirmation.</h2>
          <p>Rudra staff must review your request and verify the service, centre, price, availability and next steps. No slot was reserved and no payment was taken.</p>
          <p>{safeReceiptId ? <>Enquiry receipt reference: <strong>{safeReceiptId}</strong></> : "This link does not contain a valid receipt reference. Return to the request form or contact Rudra."}</p>
          <p>The reference identifies an acknowledgement only. It cannot be used to look up or access personal, patient or report information.</p>
        </div>
      </div>
      <div className="r-confirmation-actions">
        <Link className="r-button r-button-outline" href="/tests">Explore tests</Link>
        <Link className="r-button" href="/book">Return to request form</Link>
        <Link className="r-button r-button-outline" href="/report-access">Report access information</Link>
      </div>
    </section>
  </main>;
}
