import { describe, expect, it } from "vitest";
import { chooseAuthorizedCentre, resolveAppointmentDeepLink } from "./authorized-centre-selection";

describe("authorized centre deep links", () => {
  const centres = [{ id: "centre-a" }, { id: "centre-b" }];

  it("preserves a requested centre only when it is in the authorized result", () => {
    expect(chooseAuthorizedCentre(centres, "centre-b")).toBe("centre-b");
    expect(chooseAuthorizedCentre(centres, "outside-scope")).toBe("centre-a");
    expect(chooseAuthorizedCentre(centres, null)).toBe("centre-a");
    expect(chooseAuthorizedCentre([], "centre-b")).toBe("");
  });

  it("accepts only known appointment filters from a deep link and preserves fixed queue status", () => {
    expect(resolveAppointmentDeepLink(centres, "centre-b", "REQUESTED")).toEqual({ centreId: "centre-b", status: "REQUESTED" });
    expect(resolveAppointmentDeepLink(centres, "outside-scope", "REQUESTED")).toEqual({ centreId: "centre-a", status: "REQUESTED" });
    expect(resolveAppointmentDeepLink(centres, "centre-b", "patient@example.test")).toEqual({ centreId: "centre-b", status: "" });
    expect(resolveAppointmentDeepLink(centres, "centre-b", "CANCELLED", "REQUESTED")).toEqual({ centreId: "centre-b", status: "REQUESTED" });
    expect(resolveAppointmentDeepLink(centres, null, null)).toEqual({ centreId: "", status: "" });
  });
});
