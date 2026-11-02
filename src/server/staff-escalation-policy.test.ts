import { describe, expect, it } from "vitest";
import { canManageEscalation, escalationActionAllowed, escalationReadScope } from "@/server/staff-escalation-policy";

describe("staff escalation policy", () => {
  const assigned = { assignedOwnerStaffId: "staff-a", actorStaffId: "staff-a", canManage: false };
  it("allows only the assigned owner to acknowledge or resolve without management authority", () => {
    expect(escalationActionAllowed({ ...assigned, action: "ACKNOWLEDGE", status: "OPEN" })).toBe(true);
    expect(escalationActionAllowed({ ...assigned, action: "RESOLVE", status: "ACKNOWLEDGED" })).toBe(true);
    expect(escalationActionAllowed({ ...assigned, actorStaffId: "staff-b", action: "RESOLVE", status: "OPEN" })).toBe(false);
  });
  it("fails closed for invalid transitions and manager-only changes", () => {
    expect(escalationActionAllowed({ ...assigned, action: "ACKNOWLEDGE", status: "RESOLVED" })).toBe(false);
    expect(escalationActionAllowed({ ...assigned, action: "REOPEN", status: "RESOLVED" })).toBe(false);
    expect(escalationActionAllowed({ ...assigned, canManage: true, action: "REOPEN", status: "RESOLVED" })).toBe(true);
    expect(escalationActionAllowed({ ...assigned, canManage: true, action: "CANCEL", status: "RESOLVED" })).toBe(false);
  });
  it("prevents assigned staff from cancelling or reassigning", () => {
    expect(escalationActionAllowed({ ...assigned, action: "CANCEL", status: "OPEN" })).toBe(false);
    expect(escalationActionAllowed({ ...assigned, action: "REASSIGN", status: "OPEN" })).toBe(false);
    expect(escalationActionAllowed({ ...assigned, canManage: true, action: "REASSIGN", status: "ACKNOWLEDGED" })).toBe(true);
  });
  it("keeps broad-centre records separate from assignment-only centre records", () => {
    expect(escalationReadScope([
      { key: "escalations.read", centreId: "centre-a" },
      { key: "escalations.assigned.read", centreId: "centre-b" },
    ], "staff-a")).toEqual({ allCentresBroad: false, broadCentres: ["centre-a"], assignedCentres: ["centre-b"], assignedEverywhere: false, staffId: "staff-a" });
  });
  it("derives escalation management controls from the record centre", () => {
    const grants = [{ key: "escalations.manage", centreId: "centre-a" }];
    expect(canManageEscalation(grants, "centre-a")).toBe(true);
    expect(canManageEscalation(grants, "centre-b")).toBe(false);
    expect(canManageEscalation([{ key: "escalations.manage", centreId: null }], "centre-b")).toBe(true);
  });

  it("allows escalation detail updates only to managers on active escalations", () => {
    expect(escalationActionAllowed({ action: "UPDATE", status: "OPEN", assignedOwnerStaffId: "staff-a", actorStaffId: "staff-b", canManage: true })).toBe(true);
    expect(escalationActionAllowed({ action: "UPDATE", status: "RESOLVED", assignedOwnerStaffId: "staff-a", actorStaffId: "staff-b", canManage: true })).toBe(false);
    expect(escalationActionAllowed({ action: "UPDATE", status: "OPEN", assignedOwnerStaffId: "staff-a", actorStaffId: "staff-b", canManage: false })).toBe(false);
  });
});
