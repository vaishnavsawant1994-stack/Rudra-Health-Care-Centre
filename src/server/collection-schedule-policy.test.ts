import { describe, expect, it } from "vitest";
import { isValidScheduleDate, localCalendarDate } from "./collection-schedule-policy";

describe("collection schedule date policy", () => {
  it("accepts real ISO calendar dates and rejects malformed or normalized dates", () => {
    expect(isValidScheduleDate("2026-10-31")).toBe(true);
    expect(isValidScheduleDate("2026-02-29")).toBe(false);
    expect(isValidScheduleDate("2024-02-29")).toBe(true);
    expect(isValidScheduleDate("2026-13-01")).toBe(false);
    expect(isValidScheduleDate("10/31/2026")).toBe(false);
  });

  it("formats the browser's local calendar date without converting it to UTC", () => {
    expect(localCalendarDate(new Date(2026, 9, 31, 23, 30))).toBe("2026-10-31");
  });
});
