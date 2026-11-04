import { describe, expect, it } from "vitest";
import { taskReferenceHref } from "./task-reference-link";

describe("task operational reference links", () => {
  it.each([
    ["PUBLIC_ENQUIRY", "enquiry-id", "/leads/public-enquiries?enquiryId=enquiry-id&centreId=centre-id"],
    ["SAMPLE_EXCEPTION", "exception-id", "/samples/exceptions?exceptionId=exception-id&centreId=centre-id"],
    ["LEAD_FOLLOWUP", "followup-id", "/leads/followups?followupId=followup-id&centreId=centre-id"],
    ["REPORT_FOLLOWUP", "report-followup-id", "/reports/followups?followupId=report-followup-id&centreId=centre-id"],
    ["STAFF_TASK", "task-id", "/tasks?taskId=task-id&centreId=centre-id"],
    ["STAFF_ESCALATION", "escalation-id", "/escalations?escalationId=escalation-id&centreId=centre-id"],
  ])("deep-links %s references with centre scope", (type, id, expected) => {
    expect(taskReferenceHref(type, id, "centre-id")).toBe(expected);
  });

  it("encodes opaque IDs and returns null for unknown types", () => {
    expect(taskReferenceHref("PUBLIC_ENQUIRY", "id/with?reserved", "centre-id")).toBe("/leads/public-enquiries?enquiryId=id%2Fwith%3Freserved&centreId=centre-id");
    expect(taskReferenceHref("UNKNOWN", "opaque-id", "centre-id")).toBeNull();
  });
});
