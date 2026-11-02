import { describe, expect, it } from "vitest";
import { isAssignedCollector, sampleCollectSchema, sampleDirectoryStatuses } from "./sample-policy";

describe("collection and sample policy", () => {
  it("limits field actions to the assigned collector or an authorized scheduler", () => {
    expect(isAssignedCollector("staff-a", "staff-a", [], "centre-a")).toBe(true);
    expect(isAssignedCollector("staff-b", "staff-a", [], "centre-a")).toBe(false);
    expect(isAssignedCollector("staff-b", "staff-a", [{ key: "collections.assign", centreId: "centre-a" }], "centre-a")).toBe(true);
    expect(isAssignedCollector("staff-b", "staff-a", [{ key: "collections.assign", centreId: "centre-b" }], "centre-a")).toBe(false);
  });
  it("requires an explicit patient identity confirmation and local procedure reference", () => {
    const base = { jobId: "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5", specimenType: "Synthetic tube", requirementReference: "SYNTHETIC-SOP-1", procedureApprovalId: "a8bad75c-b226-46d8-b238-86501998dd41", reason: "Synthetic collection" };
    expect(sampleCollectSchema.safeParse({ ...base, identityCheckConfirmed: true }).success).toBe(true);
    expect(sampleCollectSchema.safeParse({ ...base, identityCheckConfirmed: false }).success).toBe(false);
    expect(sampleCollectSchema.safeParse({ ...base, identityCheckConfirmed: true, requirementReference: "" }).success).toBe(false);
  });
});

describe("sample directory query filters", () => {
  it("uses authoritative status filters for receiving, phlebotomist handover and exception queues", () => {
    expect(sampleDirectoryStatuses("all")).toBeNull();
    expect(sampleDirectoryStatuses("receiving")).toEqual(["COLLECTED"]);
    expect(sampleDirectoryStatuses("handover")).toEqual(["COLLECTED"]);
    expect(sampleDirectoryStatuses("exceptions")).toEqual(["EXCEPTION", "RECOLLECTION_REQUIRED"]);
  });
});
