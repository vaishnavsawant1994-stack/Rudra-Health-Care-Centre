import { describe, expect, it } from "vitest";
import { mayManageWalkInQueueAtCentre } from "@/lib/walk-in-queue-permissions";

describe("walk-in queue action scope", () => {
  it("requires update permission in the selected centre", () => {
    const grants = [{ key: "appointments.update", centreId: "centre-a" }];
    expect(mayManageWalkInQueueAtCentre(grants, "centre-a")).toBe(true);
    expect(mayManageWalkInQueueAtCentre(grants, "centre-b")).toBe(false);
    expect(mayManageWalkInQueueAtCentre([], "centre-a")).toBe(false);
  });

  it("accepts organization-wide update permission", () => {
    expect(mayManageWalkInQueueAtCentre([{ key: "appointments.update", centreId: null }], "centre-b")).toBe(true);
  });
});
