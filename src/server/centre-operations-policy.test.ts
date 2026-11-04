import { describe, expect, it } from "vitest";
import { canViewAnyOperationsSummary, canViewOperationsMetric, canViewTaskApprovalExpiryQueue, canViewTeamRosterMetrics, collectionQueueTitle, collectionSummaryIsAssignedOnly, openCollectionJobStatuses, sampleExceptionSummaryScope, visibleOperationsCentres } from "./centre-operations-policy";

describe("centre operations aggregate scope", () => {
  it("does not expose a centre list without operational grants", () => {
    expect(visibleOperationsCentres([{ key: "patients.read", centreId: "c1" }])).toEqual([]);
    expect(canViewAnyOperationsSummary([{ key: "roster.handover", centreId: "c1" }])).toBe(false);
    expect(canViewAnyOperationsSummary([{ key: "patients.read", centreId: "c1" }])).toBe(false);
    expect(canViewAnyOperationsSummary([{ key: "orders.read", centreId: "c1" }])).toBe(true);
  });

  it("limits scoped staff to granted centres and organization grants to all centres", () => {
    expect(visibleOperationsCentres([{ key: "orders.read", centreId: "c1" }, { key: "appointments.read", centreId: "c2" }])).toEqual(["c1", "c2"]);
    expect(visibleOperationsCentres([{ key: "orders.read", centreId: null }])).toBeNull();
    expect(canViewOperationsMetric([{ key: "orders.read", centreId: "c1" }], "orders.read", "c2")).toBe(false);
  });

  it("keeps field staff collection summaries assigned-only without assignment authority", () => {
    expect(collectionSummaryIsAssignedOnly([{ key: "collections.visit.record", centreId: "c1" }], "c1")).toBe(true);
    expect(collectionSummaryIsAssignedOnly([{ key: "collections.visit.record", centreId: "c1" }, { key: "collections.assign", centreId: "c1" }], "c1")).toBe(false);
    expect(collectionSummaryIsAssignedOnly([{ key: "collections.visit.record", centreId: "c1" }, { key: "collections.read", centreId: "c1" }], "c1")).toBe(true);
    expect(collectionSummaryIsAssignedOnly([{ key: "collections.visit.record", centreId: "c1" }, { key: "collections.assign", centreId: null }], "c1")).toBe(false);
  });

  it("keeps unsuccessful collection visits in open work and labels their follow-up", () => {
    expect(openCollectionJobStatuses).toContain("UNSUCCESSFUL");
    expect(collectionQueueTitle("UNSUCCESSFUL")).toBe("Unsuccessful collection needs follow-up");
    expect(collectionQueueTitle("PENDING_ASSIGNMENT")).toBe("Collection awaiting assignment");
  });

  it("includes authorized sample operations in the centre list scope", () => {
    expect(visibleOperationsCentres([{ key: "samples.receive", centreId: "c2" }])).toEqual(["c2"]);
    expect(canViewOperationsMetric([{ key: "samples.dispatch", centreId: null }], "samples.dispatch", "c1")).toBe(true);
  });

  it("allows only explicit follow-up permissions to add their centre to the summary", () => {
    expect(visibleOperationsCentres([{ key: "leads.followups.manage", centreId: "c3" }])).toEqual(["c3"]);
    expect(canViewOperationsMetric([{ key: "reports.followups.manage", centreId: "c3" }], "reports.followups.manage", "c3")).toBe(true);
    expect(canViewOperationsMetric([{ key: "reports.read", centreId: "c3" }], "reports.followups.manage", "c3")).toBe(false);
  });

  it("allows lead readers to see only centre-scoped website enquiry review queues", () => {
    expect(visibleOperationsCentres([{ key: "leads.read", centreId: "crm-centre" }])).toEqual(["crm-centre"]);
    expect(canViewOperationsMetric([{ key: "leads.read", centreId: "crm-centre" }], "leads.read", "crm-centre")).toBe(true);
    expect(canViewOperationsMetric([{ key: "leads.read", centreId: "crm-centre" }], "leads.read", "other-centre")).toBe(false);
  });

  it("includes task and roster queues only in explicitly granted centre scope", () => {
    expect(visibleOperationsCentres([{ key: "tasks.read", centreId: "c4" }, { key: "roster.read", centreId: "c5" }])).toEqual(["c4", "c5"]);
    expect(canViewOperationsMetric([{ key: "tasks.assigned.read", centreId: "c4" }], "tasks.assigned.read", "c4")).toBe(true);
    expect(canViewOperationsMetric([{ key: "roster.read", centreId: "c4" }], "roster.read", "c5")).toBe(false);
  });

  it("allows support readers to see only their permitted centre summaries", () => {
    const grants = [{ key: "tasks.support.read", centreId: "support-centre" }];
    expect(canViewAnyOperationsSummary(grants)).toBe(true);
    expect(visibleOperationsCentres(grants)).toEqual(["support-centre"]);
    expect(canViewOperationsMetric(grants, "tasks.support.read", "support-centre")).toBe(true);
    expect(canViewOperationsMetric(grants, "tasks.support.read", "other-centre")).toBe(false);
  });

  it("does not expose centre-wide roster totals to self-scoped roster readers", () => {
    expect(canViewTeamRosterMetrics([{ key: "roster.read", centreId: "c4" }], "c4")).toBe(false);
    expect(canViewTeamRosterMetrics([{ key: "roster.manage", centreId: "c4" }], "c4")).toBe(true);
    expect(canViewTeamRosterMetrics([{ key: "staff.read", centreId: null }], "c4")).toBe(true);
    expect(canViewTeamRosterMetrics([{ key: "staff.read", centreId: "c5" }], "c4")).toBe(false);
  });

  it("limits exception summaries to a field worker's own assigned samples", () => {
    expect(sampleExceptionSummaryScope([
      { key: "samples.read", centreId: "c1" },
      { key: "samples.collect", centreId: "c1" },
    ], "c1")).toBe("assigned");
    expect(sampleExceptionSummaryScope([
      { key: "samples.read", centreId: "c1" },
      { key: "samples.collect", centreId: "c1" },
      { key: "collections.assign", centreId: "c1" },
    ], "c1")).toBe("all");
    expect(sampleExceptionSummaryScope([{ key: "samples.exceptions.manage", centreId: "c1" }], "c1")).toBe("all");
    expect(sampleExceptionSummaryScope([{ key: "samples.read", centreId: "c2" }], "c1")).toBe("none");
  });

  it("exposes approval-expiry summaries only to centre-scoped approvers who can read the task queue", () => {
    const grants = [{ key: "tasks.approve", centreId: "c7" }, { key: "tasks.read", centreId: "c7" }];
    expect(visibleOperationsCentres(grants)).toEqual(["c7"]);
    expect(canViewTaskApprovalExpiryQueue(grants, "c7")).toBe(true);
    expect(canViewTaskApprovalExpiryQueue([{ key: "tasks.approve", centreId: "c7" }], "c7")).toBe(false);
    expect(canViewTaskApprovalExpiryQueue([{ key: "tasks.approve", centreId: "c7" }, { key: "tasks.read", centreId: "c8" }], "c7")).toBe(false);
  });

  it("includes centre escalation permissions in the operations scope", () => {
    expect(visibleOperationsCentres([{ key: "escalations.read", centreId: "c6" }])).toEqual(["c6"]);
    expect(visibleOperationsCentres([{ key: "escalations.assigned.read", centreId: null }])).toBeNull();
  });

  it("allows an Accounts-only grant to open its centre's operations summary", () => {
    expect(visibleOperationsCentres([{ key: "finance.read", centreId: "accounts-centre" }])).toEqual(["accounts-centre"]);
    expect(canViewOperationsMetric([{ key: "finance.read", centreId: "accounts-centre" }], "finance.read", "other-centre")).toBe(false);
  });
});
