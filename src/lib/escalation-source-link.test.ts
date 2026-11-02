import { describe, expect, it } from "vitest";
import { escalationSourceHref } from "./escalation-source-link";

describe("escalation source links", () => {
  it("deep-links CRM and report follow-ups using only opaque record identifiers", () => {
    expect(escalationSourceHref("LEAD_FOLLOWUP", "followup-opaque-id", "centre-id")).toBe("/leads/followups?followupId=followup-opaque-id&centreId=centre-id");
    expect(escalationSourceHref("REPORT_FOLLOWUP", "report-followup-id", "centre-id")).toBe("/reports/followups?followupId=report-followup-id&centreId=centre-id");
  });

  it("preserves centre-scoped relationship links and returns no route for unknown sources", () => {
    expect(escalationSourceHref("CORPORATE_RELATIONSHIP", "relationship-id", "centre-id")).toBe("/relationships/corporate?relationshipId=relationship-id&centreId=centre-id");
    expect(escalationSourceHref("NOT_A_SOURCE", "opaque-id")).toBeNull();
  });
});
