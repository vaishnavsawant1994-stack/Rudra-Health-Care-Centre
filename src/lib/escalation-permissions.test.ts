import { describe, expect, it } from "vitest";
import { canManageEscalationInCentre } from "./escalation-permissions";

describe("escalation workbench centre permissions", () => {
  it("does not carry manager controls into another centre", () => {
    const grants = [{ key: "escalations.manage", centreId: "centre-a" }];
    expect(canManageEscalationInCentre(grants, "centre-a")).toBe(true);
    expect(canManageEscalationInCentre(grants, "centre-b")).toBe(false);
  });

  it("honors organization-wide management grants", () => {
    expect(canManageEscalationInCentre([{ key: "escalations.manage", centreId: null }], "centre-b")).toBe(true);
  });
});
