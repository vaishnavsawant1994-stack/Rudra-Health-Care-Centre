import { describe, expect, it } from "vitest";
import { canAssignAppointmentsInCentre, canAssignCollectionsInCentre, canCreateEscalationInCentre, canManageRosterInCentre } from "@/lib/roster-permissions";

describe("roster UI permissions", () => {
  it("matches grants only for the selected centre or organization-wide grants", () => {
    const grants = [{ key: "roster.manage", centreId: "centre-a" }, { key: "appointments.assign", centreId: "centre-a" }, { key: "appointments.update", centreId: "centre-a" }, { key: "collections.assign", centreId: null }, { key: "escalations.create", centreId: "centre-b" }];
    expect(canManageRosterInCentre(grants, "centre-a")).toBe(true);
    expect(canManageRosterInCentre(grants, "centre-b")).toBe(false);
    expect(canAssignAppointmentsInCentre(grants, "centre-a")).toBe(true);
    expect(canAssignAppointmentsInCentre(grants, "centre-b")).toBe(false);
    expect(canAssignCollectionsInCentre(grants, "centre-b")).toBe(true);
    expect(canCreateEscalationInCentre(grants, "centre-a")).toBe(false);
    expect(canCreateEscalationInCentre(grants, "centre-b")).toBe(true);
  });

  it("requires both appointment assignment and update permissions", () => {
    expect(canAssignAppointmentsInCentre([{ key: "appointments.assign", centreId: "centre-a" }], "centre-a")).toBe(false);
    expect(canAssignAppointmentsInCentre([{ key: "appointments.assign", centreId: "centre-a" }, { key: "appointments.update", centreId: "centre-b" }], "centre-a")).toBe(false);
  });
});
