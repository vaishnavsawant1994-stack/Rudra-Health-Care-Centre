import { describe, expect, it } from "vitest";
import { getPublicEnquiryReceiptCopy } from "./public-enquiry-receipt";

describe("public enquiry receipt copy", () => {
  it("keeps a received booking request distinct from a confirmed appointment", () => {
    const copy = getPublicEnquiryReceiptCopy("booking");
    expect(copy.title).toContain("request was received");
    expect(copy.message).toContain("not a confirmed appointment");
    expect(copy.message).toContain("no time slot");
    expect(copy.message).toContain("no diagnostic price");
    expect(copy.nextStep).toContain("Wait for staff to confirm");
  });

  it("does not imply an outbound contact happened for a general enquiry", () => {
    const copy = getPublicEnquiryReceiptCopy("inquiry");
    expect(copy.title).toContain("enquiry was received");
    expect(copy.message).toContain("No message, call or marketing communication has been sent automatically");
    expect(copy.nextStep).toBeNull();
  });
});
