import { describe, expect, it } from "vitest";
import { buildRosterCalendarDays } from "./roster-calendar";

describe("weekly roster calendar projection", () => {
  it("groups shifts and unavailability by centre-local date and spans overnight entries", () => {
    const days = buildRosterCalendarDays([
      { id: "shift-1", staffId: "staff-1", staffName: "Synthetic Staff A", staffCode: "SYN-A", shiftType: "SCHEDULED", startsAt: "2026-11-02T03:30:00.000Z", endsAt: "2026-11-02T04:30:00.000Z", timeZone: "Asia/Kolkata", note: "" },
      { id: "shift-2", staffId: "staff-2", staffName: "Synthetic Staff B", staffCode: "SYN-B", shiftType: "UNAVAILABLE", startsAt: "2026-11-02T19:30:00.000Z", endsAt: "2026-11-02T21:30:00.000Z", timeZone: "Asia/Kolkata", note: "Synthetic leave marker" },
      { id: "shift-3", staffId: "staff-3", staffName: "Synthetic Staff C", staffCode: "SYN-C", shiftType: "SCHEDULED", startsAt: "2026-11-08T17:00:00.000Z", endsAt: "2026-11-08T17:30:00.000Z", timeZone: "Asia/Kolkata", note: "" },
    ], new Date("2026-11-01T18:30:00.000Z"), "Asia/Kolkata");

    expect(days).toHaveLength(7);
    expect(days[0]).toMatchObject({ key: "2026-11-02", label: "Mon 02 Nov" });
    expect(days[0].entries.map((entry) => entry.id)).toEqual(["shift-1"]);
    expect(days[1].entries.map((entry) => entry.id)).toEqual(["shift-2"]);
    expect(days[6].entries.map((entry) => entry.id)).toEqual(["shift-3"]);
  });

  it("does not create phantom calendar entries from invalid or zero-length times", () => {
    const days = buildRosterCalendarDays([
      { id: "bad-date", staffId: "staff-1", staffName: "Synthetic Staff", staffCode: "SYN", shiftType: "SCHEDULED", startsAt: "bad", endsAt: "2026-11-02T04:30:00.000Z", timeZone: "Asia/Kolkata", note: "" },
      { id: "zero", staffId: "staff-1", staffName: "Synthetic Staff", staffCode: "SYN", shiftType: "SCHEDULED", startsAt: "2026-11-02T04:30:00.000Z", endsAt: "2026-11-02T04:30:00.000Z", timeZone: "Asia/Kolkata", note: "" },
    ], new Date("2026-11-01T18:30:00.000Z"), "Asia/Kolkata");

    expect(days.every((day) => day.entries.length === 0)).toBe(true);
  });
});
