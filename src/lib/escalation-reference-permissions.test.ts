import { describe, expect, it } from "vitest";
import { getEscalationReferenceTypes } from "./escalation-reference-permissions";

describe("escalation reference permissions", () => {
  it("limits the source picker to readable domains", () => {
    expect(getEscalationReferenceTypes([
      { key: "collections.visit.record", centreId: "centre-a" },
      { key: "tasks.assigned.read", centreId: "centre-a" },
      { key: "leads.read", centreId: "centre-b" },
    ])).toEqual(["LEAD", "PUBLIC_ENQUIRY", "COLLECTION_JOB", "STAFF_TASK"]);
  });

  it("returns no source types when create authority has no related-record read grant", () => {
    expect(getEscalationReferenceTypes([{ key: "escalations.create", centreId: "centre-a" }])).toEqual([]);
  });

  it("includes assigned appointment-reader access without broad appointment read", () => {
    expect(getEscalationReferenceTypes([{ key: "appointments.assigned.read", centreId: "centre-a" }])).toEqual(["APPOINTMENT"]);
  });

  it("filters centre-scoped read permissions for the selected centre", () => {
    const grants = [
      { key: "leads.read", centreId: "centre-a" },
      { key: "reports.read", centreId: "centre-b" },
      { key: "appointments.read", centreId: null },
    ];
    expect(getEscalationReferenceTypes(grants, "centre-a")).toEqual(["APPOINTMENT", "LEAD", "PUBLIC_ENQUIRY"]);
    expect(getEscalationReferenceTypes(grants, "centre-b")).toEqual(["APPOINTMENT", "REPORT"]);
    expect(getEscalationReferenceTypes(grants, "centre-c")).toEqual(["APPOINTMENT"]);
  });
});
