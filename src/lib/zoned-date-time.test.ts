import { describe, expect, it } from "vitest";
import { formatDateTimeInZone, localInputToIsoInZone, toDateTimeInputInZone, zonedWeekRange } from "./zoned-date-time";

describe("centre timezone scheduling helpers", () => {
  it("builds week boundaries from the centre's local Monday across a DST change", () => {
    const range = zonedWeekRange(new Date("2026-03-08T12:00:00.000Z"), "America/New_York");
    expect(range?.monday).toBe("2026-03-02");
    expect(range?.from.toISOString()).toBe("2026-03-02T05:00:00.000Z");
    expect(range?.to.toISOString()).toBe("2026-03-09T04:00:00.000Z");
    expect(range && (range.to.getTime() - range.from.getTime()) / 3_600_000).toBe(167);
  });

  it("converts local shift input and renders it in the centre timezone", () => {
    const instant = localInputToIsoInZone("2026-10-30T09:00", "Asia/Kolkata");
    expect(instant).toBe("2026-10-30T03:30:00.000Z");
    expect(toDateTimeInputInZone(instant!, "Asia/Kolkata")).toBe("2026-10-30T09:00");
    expect(formatDateTimeInZone(instant!, "Asia/Kolkata")).toContain("09:00");
  });

  it("rejects nonexistent DST wall times and malformed calendar input", () => {
    expect(localInputToIsoInZone("2026-03-08T02:30", "America/New_York")).toBeNull();
    expect(localInputToIsoInZone("2026-02-31T09:00", "Asia/Kolkata")).toBeNull();
  });
});
