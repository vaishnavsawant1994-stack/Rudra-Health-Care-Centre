import { describe, expect, it } from "vitest";
import { filterHandoverWorkSnapshot, readableHandoverCategories } from "@/server/shift-handover-workload";

describe("shift handover workload snapshot visibility", () => {
  const centreId = "centre-a";
  const snapshot = {
    capturedAt: "2026-11-04T10:00:00.000Z",
    categories: { appointments: { count: 3 }, collections: { count: 2 }, tasks: { count: 5 } },
  };

  it("captures only categories covered by centre-wide read grants", () => {
    expect(readableHandoverCategories([
      { key: "roster.manage", centreId },
      { key: "appointments.read", centreId },
      { key: "tasks.assigned.read", centreId },
    ], centreId)).toEqual(["appointments"]);
  });

  it("filters historical counts against the current viewer's centre-wide read grants", () => {
    expect(filterHandoverWorkSnapshot(snapshot, [
      { key: "appointments.read", centreId },
      { key: "tasks.read", centreId: null },
    ], centreId)).toEqual({
      capturedAt: snapshot.capturedAt,
      categories: { appointments: { count: 3 }, tasks: { count: 5 } },
    });
  });

  it("does not treat roster management, handover, or assigned-only access as queue read permission", () => {
    expect(filterHandoverWorkSnapshot(snapshot, [
      { key: "roster.manage", centreId },
      { key: "roster.handover", centreId },
      { key: "appointments.assigned.read", centreId },
      { key: "tasks.assigned.read", centreId },
    ], centreId)).toBeNull();
  });

  it("rejects malformed snapshots and invalid counts", () => {
    expect(filterHandoverWorkSnapshot({ capturedAt: "not-a-date", categories: { tasks: { count: 1 } } }, [{ key: "tasks.read", centreId }], centreId)).toBeNull();
    expect(filterHandoverWorkSnapshot({ capturedAt: snapshot.capturedAt, categories: { tasks: { count: -1 } } }, [{ key: "tasks.read", centreId }], centreId)).toBeNull();
  });
});
