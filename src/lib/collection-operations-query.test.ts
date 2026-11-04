import { describe, expect, it } from "vitest";
import { collectionOperationsQuery } from "./collection-operations-query";

describe("collection operations schedule filtering", () => {
  it("keeps centre and pagination while applying the selected local calendar date", () => {
    const query = collectionOperationsQuery({ page: 2, pageSize: 50, centreId: "centre-1", scheduleDate: "2026-11-10", includeScheduleDate: true });
    expect([...query.entries()]).toEqual([["page", "2"], ["pageSize", "50"], ["centreId", "centre-1"], ["date", "2026-11-10"]]);
  });

  it("does not narrow the manager's queue when date filtering is disabled or cleared", () => {
    const disabled = collectionOperationsQuery({ page: 1, pageSize: 50, centreId: "centre-1", scheduleDate: "2026-11-10", includeScheduleDate: false });
    const cleared = collectionOperationsQuery({ page: 1, pageSize: 50, centreId: "centre-1", scheduleDate: "", includeScheduleDate: true });
    expect(disabled.has("date")).toBe(false);
    expect(cleared.has("date")).toBe(false);
    expect(disabled.get("centreId")).toBe("centre-1");
  });

  it("requests only the signed-in staff member's route for the selected date", () => {
    const query = collectionOperationsQuery({ page: 1, pageSize: 100, centreId: "", scheduleDate: "2026-11-04", includeScheduleDate: true, assignedToMe: true });
    expect([...query.entries()]).toEqual([["page", "1"], ["pageSize", "100"], ["date", "2026-11-04"], ["assignedToMe", "1"]]);
  });

  it("preserves an explicitly selected visit-stage filter", () => {
    const query = collectionOperationsQuery({ page: 1, pageSize: 50, centreId: "centre-1", scheduleDate: "", includeScheduleDate: false, visitStage: "ARRIVED" });
    expect(query.get("visitStage")).toBe("ARRIVED");
    expect(query.has("date")).toBe(false);
  });
});
