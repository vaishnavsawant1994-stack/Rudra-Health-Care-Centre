import { describe, expect, it } from "vitest";
import { rosterAssignmentConflictFlags, rosterConflictEscalationSourceType, staffAssignmentLockKey } from "@/server/staff-roster-policy";

describe("roster assignment conflict indicators", () => {
  it("maps conflict types to escalation source types accepted by the escalation API", () => {
    expect(rosterConflictEscalationSourceType("APPOINTMENT")).toBe("APPOINTMENT");
    expect(rosterConflictEscalationSourceType("COLLECTION")).toBe("COLLECTION_JOB");
  });

  it("uses an organization-scoped lock key for both appointment and collection assignments", () => {
    expect(staffAssignmentLockKey("org-1", "staff-1")).toBe("org-1:collection-staff:staff-1");
    expect(staffAssignmentLockKey("org-2", "staff-1")).not.toBe(staffAssignmentLockKey("org-1", "staff-1"));
  });
  const date = (hour: number) => new Date(Date.UTC(2026, 9, 29, Math.floor(hour), (hour % 1) * 60));
  it("flags work outside scheduled hours and during unavailability as advisory", () => {
    const work = [{ id: "a1", staffId: "s1", startsAt: date(8), endsAt: date(9) }];
    const shifts = [{ staffId: "s1", shiftType: "SCHEDULED" as const, startsAt: date(10), endsAt: date(18) }, { staffId: "s1", shiftType: "UNAVAILABLE" as const, startsAt: date(8), endsAt: date(10) }];
    expect(rosterAssignmentConflictFlags(work, shifts)[0].advisoryFlags).toEqual(["OUTSIDE_SCHEDULED_SHIFT", "DURING_UNAVAILABILITY"]);
  });
  it("flags overlapping work assigned to the same staff member only", () => {
    const work = [
      { id: "a1", staffId: "s1", startsAt: date(9), endsAt: date(10) },
      { id: "c1", staffId: "s1", startsAt: date(9.5), endsAt: date(10.5) },
      { id: "a2", staffId: "s2", startsAt: date(9), endsAt: date(10) },
    ];
    expect(Object.fromEntries(rosterAssignmentConflictFlags(work, []).map((item) => [item.id, item.advisoryFlags]))).toEqual({
      a1: ["OUTSIDE_SCHEDULED_SHIFT", "OVERLAPPING_ASSIGNMENT"],
      c1: ["OUTSIDE_SCHEDULED_SHIFT", "OVERLAPPING_ASSIGNMENT"],
      a2: ["OUTSIDE_SCHEDULED_SHIFT"],
    });
  });
  it("does not flag an assignment covered by a scheduled shift", () => {
    const work = [{ id: "a1", staffId: "s1", startsAt: date(9), endsAt: date(10) }];
    const shifts = [{ staffId: "s1", shiftType: "SCHEDULED" as const, startsAt: date(8), endsAt: date(17) }];
    expect(rosterAssignmentConflictFlags(work, shifts)).toEqual([]);
  });
});
