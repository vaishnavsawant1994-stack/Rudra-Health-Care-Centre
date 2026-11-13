import { describe, expect, it } from "vitest";
import { canAssignSupportFollowupAtCentre, canCreateStaffTaskAtCentre, canCreateSupportFollowupAtCentre } from "./staff-task-access";

describe("support follow-up centre permissions", () => {
  it("only offers assignee selection with a centre or organization tasks.assign grant", () => {
    expect(canAssignSupportFollowupAtCentre([{ key: "tasks.assign", centreId: "centre-a" }], "centre-a")).toBe(true);
    expect(canAssignSupportFollowupAtCentre([{ key: "tasks.assign", centreId: null }], "centre-b")).toBe(true);
    expect(canAssignSupportFollowupAtCentre([{ key: "tasks.assign", centreId: "centre-a" }], "centre-b")).toBe(false);
    expect(canAssignSupportFollowupAtCentre([{ key: "tasks.create", centreId: "centre-a" }], "centre-a")).toBe(false);
  });

  it("only offers task creation in a centre covered by a centre or organization grant", () => {
    const centreGrant = [{ key: "tasks.create", centreId: "centre-a" }, { key: "workspace.read", centreId: null }];
    expect(canCreateStaffTaskAtCentre(centreGrant, "centre-a")).toBe(true);
    expect(canCreateStaffTaskAtCentre(centreGrant, "centre-b")).toBe(false);
    expect(canCreateStaffTaskAtCentre([{ key: "tasks.create", centreId: null }, { key: "workspace.read", centreId: null }], "centre-b")).toBe(true);
    expect(canCreateStaffTaskAtCentre([{ key: "tasks.create", centreId: null }], "centre-a")).toBe(false);
    expect(canCreateStaffTaskAtCentre([{ key: "doctors.manage", centreId: null }, { key: "workspace.read", centreId: null }], "centre-a")).toBe(false);
  });

  it("requires create, support-create and a task-read grant in the enquiry centre", () => {
    const centreA = "centre-a";
    const centreB = "centre-b";
    const base = [
      { key: "tasks.create", centreId: centreA },
      { key: "tasks.support.create", centreId: centreA },
      { key: "tasks.assigned.read", centreId: centreA },
    ];
    expect(canCreateSupportFollowupAtCentre(base, centreA)).toBe(true);
    expect(canCreateSupportFollowupAtCentre(base, centreB)).toBe(false);
    expect(canCreateSupportFollowupAtCentre(base.slice(0, 2), centreA)).toBe(false);
  });

  it("supports organization grants while respecting missing centre grants", () => {
    const grants = [
      { key: "tasks.create", centreId: null },
      { key: "tasks.support.create", centreId: "centre-a" },
      { key: "tasks.support.read", centreId: "centre-a" },
    ];
    expect(canCreateSupportFollowupAtCentre(grants, "centre-a")).toBe(true);
    expect(canCreateSupportFollowupAtCentre(grants, "centre-b")).toBe(false);
  });
});
