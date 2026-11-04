import { describe, expect, it } from "vitest";
import { escalationSourceHref } from "./escalation-source-link";

describe("escalation source links", () => {
  it("deep-links CRM and report follow-ups using only opaque record identifiers", () => {
    expect(escalationSourceHref("LEAD_FOLLOWUP", "followup-opaque-id", "centre-id")).toBe("/leads/followups?followupId=followup-opaque-id&centreId=centre-id");
    expect(escalationSourceHref("REPORT_FOLLOWUP", "report-followup-id", "centre-id")).toBe("/reports/followups?followupId=report-followup-id&centreId=centre-id");
  });

  it("deep-links relationship escalations to their protected profile routes", () => {
    expect(escalationSourceHref("CORPORATE_RELATIONSHIP", "relationship-id", "centre-id")).toBe("/relationships/corporate/relationship-id");
    expect(escalationSourceHref("PARTNER_RELATIONSHIP", "partner-id", "centre-id")).toBe("/relationships/partners/partner-id");
    expect(escalationSourceHref("DOCTOR_RELATIONSHIP", "doctor-id", "centre-id")).toBe("/relationships/doctors/doctor-id");
  });

  it("opens the specific sample exception within its authorized centre filter", () => {
    expect(escalationSourceHref("SAMPLE_EXCEPTION", "exception-opaque-id", "centre-opaque-id")).toBe("/samples/exceptions?exceptionId=exception-opaque-id&centreId=centre-opaque-id");
  });

  it("opens the specific public enquiry within its authorized centre filter", () => {
    expect(escalationSourceHref("PUBLIC_ENQUIRY", "enquiry-opaque-id", "centre-opaque-id")).toBe("/leads/public-enquiries?enquiryId=enquiry-opaque-id&centreId=centre-opaque-id");
  });

  it("deep-links staff task and escalation sources while preserving centre scope", () => {
    expect(escalationSourceHref("STAFF_TASK", "task-opaque-id", "centre-opaque-id")).toBe("/tasks?taskId=task-opaque-id&centreId=centre-opaque-id");
    expect(escalationSourceHref("STAFF_ESCALATION", "escalation-opaque-id", "centre-opaque-id")).toBe("/escalations?escalationId=escalation-opaque-id&centreId=centre-opaque-id");
  });

  it("encodes relationship IDs and returns no route for unknown sources", () => {
    expect(escalationSourceHref("CORPORATE_RELATIONSHIP", "id/with?reserved", "centre-id")).toBe("/relationships/corporate/id%2Fwith%3Freserved");
    expect(escalationSourceHref("NOT_A_SOURCE", "opaque-id")).toBeNull();
  });
});
