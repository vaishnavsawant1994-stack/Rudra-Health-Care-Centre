import { describe, expect, it } from "vitest";
import { canReceptionCheckIn } from "./appointment-arrival-policy";

describe("reception appointment arrival policy", () => {
  it("allows check-in only for confirmed, assigned, or rescheduled bookings", () => {
    expect(["CONFIRMED", "ASSIGNED", "RESCHEDULED"].every(canReceptionCheckIn)).toBe(true);
    expect(["REQUESTED", "CANCELLED", "NO_SHOW", "COMPLETED", "unknown"].some(canReceptionCheckIn)).toBe(false);
  });
});
