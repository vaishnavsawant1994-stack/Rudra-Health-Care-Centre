import { describe, expect, it } from "vitest";
import { mayAuthorizeRecollectionAtCentre, mayCollectSampleAtCentre, mayCreateCollectionJobAtCentre, mayDispatchSamplesAtCentre, mayManageProceduresAtCentre, mayManageSampleExceptionsAtCentre, mayReceiveSamplesAtCentre, mayRecordVisitAtCentre, mayVerifyExternalReceiptAtCentre } from "@/lib/sample-operations-permissions";

describe("sample operation centre permissions", () => {
  it("does not carry centre grants into another centre", () => {
    const grants = [{ key: "collections.assign", centreId: "a" }, { key: "samples.procedures.manage", centreId: "a" }, { key: "samples.receive", centreId: "b" }, { key: "samples.exceptions.manage", centreId: "a" }];
    expect(mayCreateCollectionJobAtCentre(grants, "a")).toBe(true);
    expect(mayCreateCollectionJobAtCentre(grants, "b")).toBe(false);
    expect(mayManageProceduresAtCentre(grants, "b")).toBe(false);
    expect(mayReceiveSamplesAtCentre(grants, "a")).toBe(false);
    expect(mayReceiveSamplesAtCentre(grants, "b")).toBe(true);
    expect(mayManageSampleExceptionsAtCentre(grants, "b")).toBe(false);
    expect(mayDispatchSamplesAtCentre(grants, "a")).toBe(false);
    expect(mayVerifyExternalReceiptAtCentre(grants, "a")).toBe(false);
    expect(mayAuthorizeRecollectionAtCentre(grants, "a")).toBe(false);
    const assignedOnly = [{ key: "collections.visit.record", centreId: "a" }, { key: "samples.collect", centreId: "a" }];
    expect(mayRecordVisitAtCentre(assignedOnly, "a", "staff-a", "staff-b")).toBe(false);
    expect(mayCollectSampleAtCentre(assignedOnly, "a", "staff-a", "staff-b")).toBe(false);
    expect(mayRecordVisitAtCentre(assignedOnly, "a", "staff-b", "staff-b")).toBe(true);
  });

  it("accepts organization-wide grants", () => {
    const grants = [{ key: "collections.assign", centreId: null }, { key: "samples.procedures.manage", centreId: null }, { key: "samples.receive", centreId: null }, { key: "samples.exceptions.manage", centreId: null }, { key: "samples.recollection.authorize", centreId: null }, { key: "samples.dispatch", centreId: null }, { key: "samples.external.verify", centreId: null }, { key: "collections.visit.record", centreId: null }, { key: "samples.collect", centreId: null }];
    expect(mayCreateCollectionJobAtCentre(grants, "a")).toBe(true);
    expect(mayManageProceduresAtCentre(grants, "a")).toBe(true);
    expect(mayReceiveSamplesAtCentre(grants, "a")).toBe(true);
    expect(mayManageSampleExceptionsAtCentre(grants, "a")).toBe(true);
    expect(mayAuthorizeRecollectionAtCentre(grants, "a")).toBe(true);
    expect(mayDispatchSamplesAtCentre(grants, "a")).toBe(true);
    expect(mayVerifyExternalReceiptAtCentre(grants, "a")).toBe(true);
    expect(mayRecordVisitAtCentre(grants, "a", "staff-b", "staff-a")).toBe(true);
    expect(mayCollectSampleAtCentre(grants, "a", null, "staff-a")).toBe(true);
  });

  it("requires the matching permission even for an assigned collector", () => {
    expect(mayRecordVisitAtCentre([], "a", "staff-a", "staff-a")).toBe(false);
    expect(mayCollectSampleAtCentre([{ key: "collections.visit.record", centreId: "a" }], "a", "staff-a", "staff-a")).toBe(false);
  });
});
