import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PublicEnquiryReceipt } from "./public-enquiry-receipt";

describe("public enquiry receipt", () => {
  it("shows only the opaque receipt and clearly avoids appointment or payment claims", () => {
    const receiptId = "9f741c0a-15af-4e6d-9d60-930ab7821e26";
    const markup = renderToStaticMarkup(createElement(PublicEnquiryReceipt, { receiptId }));
    expect(markup).toContain("Enquiry received for staff review");
    expect(markup).toContain(receiptId.toUpperCase());
    expect(markup).toContain("This is not an appointment confirmation.");
    expect(markup).toContain("No slot was reserved and no payment was taken.");
    expect(markup).toContain("never loads enquiry details");
    expect(markup).not.toContain("patient name");
    expect(markup).not.toContain("phone number");
  });

  it("does not reflect a malformed route value as a receipt reference", () => {
    const markup = renderToStaticMarkup(createElement(PublicEnquiryReceipt, { receiptId: "guessable-reference" }));
    expect(markup).toContain("Receipt reference unavailable");
    expect(markup).toContain("This link does not contain a valid receipt reference.");
    expect(markup).not.toContain("guessable-reference");
  });
});
