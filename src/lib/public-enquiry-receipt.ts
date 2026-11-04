export type PublicEnquiryReceiptKind = "booking" | "inquiry";

export function getPublicEnquiryReceiptCopy(kind: PublicEnquiryReceiptKind) {
  if (kind === "booking") {
    return {
      title: "Your visit request was received",
      message: "Rudra staff will review the request. This is not a confirmed appointment: no time slot or service availability has been reserved, and no diagnostic price or home-visit charge has been quoted.",
      nextStep: "Wait for staff to confirm the booking through an approved contact channel. Do not send medical results or urgent health information through this form.",
    };
  }
  return {
    title: "Your enquiry was received",
    message: "Staff will review the enquiry. No message, call or marketing communication has been sent automatically.",
    nextStep: null,
  };
}
