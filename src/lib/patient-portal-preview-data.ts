export const PATIENT_PORTAL_SCREENS = [
  { id: "P001", title: "Patient home / health overview", route: "/account" },
  { id: "P002", title: "My profile & identity", route: "/account/profile" },
  { id: "P003", title: "Family dashboard", route: "/account/family" },
  { id: "P004", title: "Member 360 & access management", route: "/account/family/synthetic-preview" },
  { id: "P005", title: "Order care-journey timeline", route: "/account/orders/synthetic-preview/journey" },
  { id: "P006", title: "My bookings & appointments", route: "/account/appointments" },
  { id: "P007", title: "Reschedule / cancel request", route: "/account/appointments/synthetic-preview/change" },
  { id: "P008", title: "Orders & sample history", route: "/account/orders" },
  { id: "P009", title: "My medical reports & sharing", route: "/account/reports" },
  { id: "P010", title: "Bills, receipts & payment history", route: "/account/billing" },
  { id: "P011", title: "Addresses & collection preferences", route: "/account/addresses" },
  { id: "P012", title: "Health calendar & reminders", route: "/account/calendar" },
  { id: "P013", title: "Help, complaints & support tickets", route: "/account/support" },
  { id: "P014", title: "Notifications and channel preferences", route: "/account/notifications" },
  { id: "P015", title: "Document vault / health passport", route: "/account/health-documents" },
  { id: "P016", title: "Comparable health trends", route: "/account/health-trends" },
] as const;

export type PatientPortalScreenId = (typeof PATIENT_PORTAL_SCREENS)[number]["id"];

/** Scenario copy only. It contains no patient identifiers, clinical values, or operational event claims. */
export const PATIENT_PORTAL_SYNTHETIC_SCENARIOS: Record<PatientPortalScreenId, readonly string[]> = {
  P001: ["Example request: awaiting centre staff review; this is not an appointment.", "No verified order, collection event, released report, bill, or notification is included."],
  P002: ["Identity state: not verified in this preview.", "Profile, contact, address, and preference fields are deliberately not populated."],
  P003: ["Family relationship: illustrative only.", "No member list or access grant is active; family status does not inherit medical access."],
  P004: ["Example access grant: PENDING_VERIFICATION.", "Authorized data: none. Expiry, revocation, and guardian authority require an approved identity workflow."],
  P005: ["Example timeline is not an order record.", "Metropolis receipt: not recorded. Processing: unverified. Collection: not verified. Report: not released."],
  P006: ["No confirmed appointment is present in this example.", "A public visit request remains subject to staff review and does not reserve a time or collection slot."],
  P007: ["No verified appointment is selected, so a change request cannot be submitted.", "Rescheduling, cancellation, slot availability, and refund rules require an authorized workflow."],
  P008: ["No order or specimen record is included in this example.", "External receipt, lab processing, collection, and report milestones remain unverified until recorded by authorized staff."],
  P009: ["No medical report or clinical result is included.", "Viewing, downloading, sharing, and revoking report access require verified patient identity and release authorization."],
  P010: ["No invoice, receipt, balance, payment, or refund is present.", "Issuer and billing policy are pending; payment actions remain unavailable."],
  P011: ["No home address or location is collected in preview mode.", "Service area, fees, and collection availability require centre confirmation; no geozone check is performed."],
  P012: ["No appointment or clinician-directed recall is scheduled.", "Reminder settings shown here are a design example only and do not schedule or send messages."],
  P013: ["Example support state: draft only; not submitted to Rudra.", "Do not enter personal or medical information. No message provider or patient ticket account is connected."],
  P014: ["No notification has been sent or delivered.", "Channel and quiet-hour controls are preview-only and are not persisted or connected to a provider."],
  P015: ["No file has been uploaded or stored.", "Document upload, encrypted storage, malware scanning, sharing, and revocation remain gated."],
  P016: ["No analyte, result, reference range, or trend is shown.", "Comparable health trends require released verified results and clinical review."],
};

export const PATIENT_PORTAL_GATE_NOTICE = "Patient sign-in and protected patient data are disabled pending approved identity proofing, account linking, consent and security review.";
