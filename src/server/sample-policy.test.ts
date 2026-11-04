import { describe, expect, it } from "vitest";
import { assignedHandoverCentreScope, collectionAttemptProgress, collectionJobActionSchema, collectionVisitStage, isAssignedCollector, matchesSpecimenCollectionReplay, sampleCollectSchema, sampleDirectoryStatusFilter, sampleDirectoryStatuses, sampleHandoverSubmitSchema } from "./sample-policy";

describe("collection and sample policy", () => {
  it("requires one arrival per travel attempt and a recorded arrival before visit outcomes", () => {
    expect(collectionAttemptProgress([])).toMatchObject({ canRecordArrival: false, canRecordDelay: false, atDestination: false, canRecordAttemptOutcome: false });
    expect(collectionAttemptProgress(["ASSIGNED", "ASSIGNMENT_ACCEPTED", "TRAVEL_STARTED"])).toMatchObject({ canRecordArrival: true, canRecordDelay: true, atDestination: false, canRecordAttemptOutcome: false });
    expect(collectionAttemptProgress(["TRAVEL_STARTED", "VISIT_DELAYED", "ARRIVED"])).toMatchObject({ canRecordArrival: false, canRecordDelay: false, atDestination: true, canRecordAttemptOutcome: true });
    expect(collectionAttemptProgress(["VISIT_STARTED", "ARRIVED", "ATTEMPT_FAILED"])).toMatchObject({ canRecordArrival: false, atDestination: false, canRecordAttemptOutcome: false });
    expect(collectionAttemptProgress(["VISIT_STARTED", "ARRIVED", "ATTEMPT_FAILED", "TRAVEL_STARTED"])).toMatchObject({ canRecordArrival: true, atDestination: false, canRecordAttemptOutcome: false });
  });
  it("derives queue visit stage from events without changing authoritative job status", () => {
    expect(collectionVisitStage("ASSIGNED", ["ASSIGNED"])).toBeNull();
    expect(collectionVisitStage("IN_PROGRESS", ["TRAVEL_STARTED", "VISIT_DELAYED"])).toBe("TRAVELLING");
    expect(collectionVisitStage("IN_PROGRESS", ["VISIT_STARTED", "ARRIVED"])).toBe("ARRIVED");
    expect(collectionVisitStage("IN_PROGRESS", [])).toBeNull();
    expect(collectionVisitStage("COLLECTED", ["TRAVEL_STARTED", "ARRIVED"])).toBeNull();
  });
  it("limits field actions to the assigned collector or an authorized scheduler", () => {
    expect(isAssignedCollector("staff-a", "staff-a", [], "centre-a")).toBe(true);
    expect(isAssignedCollector("staff-b", "staff-a", [], "centre-a")).toBe(false);
    expect(isAssignedCollector("staff-b", "staff-a", [{ key: "collections.assign", centreId: "centre-a" }], "centre-a")).toBe(true);
    expect(isAssignedCollector("staff-b", "staff-a", [{ key: "collections.assign", centreId: "centre-b" }], "centre-a")).toBe(false);
  });
  it("accepts a reasoned delay event only with an expected job version", () => {
    const delay = { action: "delay", expectedVersion: 2, reason: "Synthetic traffic delay", estimatedArrivalAt: "2099-01-01T10:00:00.000Z" };
    expect(collectionJobActionSchema.safeParse(delay).success).toBe(true);
    expect(collectionJobActionSchema.safeParse({ ...delay, estimatedArrivalAt: "not-a-date" }).success).toBe(false);
    expect(collectionJobActionSchema.safeParse({ ...delay, expectedVersion: 0 }).success).toBe(false);
    expect(collectionJobActionSchema.safeParse({ ...delay, reason: "x" }).success).toBe(false);
  });
  it("requires a versioned reason when a collector declines an assignment", () => {
    expect(collectionJobActionSchema.safeParse({ action: "decline", expectedVersion: 1, reason: "Synthetic schedule conflict" }).success).toBe(true);
    expect(collectionJobActionSchema.safeParse({ action: "decline", expectedVersion: 0, reason: "Synthetic schedule conflict" }).success).toBe(false);
    expect(collectionJobActionSchema.safeParse({ action: "decline", expectedVersion: 1, reason: "x" }).success).toBe(false);
  });
  it("requires an explicit patient identity confirmation and local procedure reference", () => {
    const base = { jobId: "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5", specimenType: "Synthetic tube", requirementReference: "SYNTHETIC-SOP-1", procedureApprovalId: "a8bad75c-b226-46d8-b238-86501998dd41", reason: "Synthetic collection" };
    expect(sampleCollectSchema.safeParse({ ...base, identityCheckConfirmed: true }).success).toBe(true);
    expect(sampleCollectSchema.safeParse({ ...base, identityCheckConfirmed: false }).success).toBe(false);
    expect(sampleCollectSchema.safeParse({ ...base, identityCheckConfirmed: true, requirementReference: "" }).success).toBe(false);
  });
  it("only replays an identical specimen request by the original collector", () => {
    const request = { jobId: "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5", specimenType: "Synthetic tube", requirementReference: "SYNTHETIC-SOP-1", identityCheckConfirmed: true as const, procedureApprovalId: "a8bad75c-b226-46d8-b238-86501998dd41", reason: "Synthetic collection" };
    const existing = { ...request, collectedByStaffId: "staff-a" };
    expect(matchesSpecimenCollectionReplay(existing, request, "staff-a")).toBe(true);
    expect(matchesSpecimenCollectionReplay({ ...existing, reason: "Different reason" }, request, "staff-a")).toBe(false);
    expect(matchesSpecimenCollectionReplay({ ...existing, procedureApprovalId: "b8bad75c-b226-46d8-b238-86501998dd41" }, request, "staff-a")).toBe(false);
    expect(matchesSpecimenCollectionReplay(existing, request, "staff-b")).toBe(false);
  });
  it("requires a versioned, reasoned handover submission for an identified specimen", () => {
    const valid = { specimenId: "af0f6a69-ccf2-4a6e-a329-150215537d87", expectedVersion: 1, reason: "Submitted to Rudra receiving queue" };
    expect(sampleHandoverSubmitSchema.safeParse(valid).success).toBe(true);
    expect(sampleHandoverSubmitSchema.safeParse({ ...valid, expectedVersion: 0 }).success).toBe(false);
    expect(sampleHandoverSubmitSchema.safeParse({ ...valid, reason: "x" }).success).toBe(false);
  });
});

describe("sample directory query filters", () => {
  it("uses authoritative status filters for receiving, phlebotomist handover and exception queues", () => {
    expect(sampleDirectoryStatuses("all")).toBeNull();
    expect(sampleDirectoryStatuses("receiving")).toEqual(["COLLECTED"]);
    expect(sampleDirectoryStatuses("handover")).toEqual(["COLLECTED"]);
    expect(sampleDirectoryStatuses("exceptions")).toEqual(["EXCEPTION", "RECOLLECTION_REQUIRED"]);
  });
  it("keeps direct exception links resolvable after the specimen advances to another valid status", () => {
    expect(sampleDirectoryStatusFilter("exceptions")).toEqual(["EXCEPTION", "RECOLLECTION_REQUIRED"]);
    expect(sampleDirectoryStatusFilter("exceptions", "synthetic-exception-id")).toBeNull();
    expect(sampleDirectoryStatusFilter("all", "synthetic-exception-id")).toBeNull();
  });
  it("keeps assigned sample handover within the collection-visit centre grants", () => {
    expect(assignedHandoverCentreScope([{ key: "collections.visit.record", centreId: "centre-a" }, { key: "collections.visit.record", centreId: "centre-b" }])).toEqual(["centre-a", "centre-b"]);
    expect(assignedHandoverCentreScope([{ key: "collections.visit.record", centreId: null }])).toBeNull();
    expect(assignedHandoverCentreScope([{ key: "samples.read", centreId: "centre-a" }])).toEqual([]);
  });
});
