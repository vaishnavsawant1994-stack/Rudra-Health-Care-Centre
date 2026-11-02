import { describe, expect, it } from "vitest";
import { formatCentreQueueTime } from "./centre-queue-time";

describe("formatCentreQueueTime", () => {
  it("renders queue timestamps in the centre timezone across a UTC date boundary", () => {
    expect(formatCentreQueueTime("2026-10-31T20:00:00.000Z", "Asia/Kolkata")).toBe("1 Nov 2026, 1:30 am");
  });

  it("fails safely for invalid timestamps or timezones", () => {
    expect(formatCentreQueueTime("not-a-date", "Asia/Kolkata")).toBe("Time unavailable");
    expect(formatCentreQueueTime("2026-10-31T20:00:00.000Z", "Not/AZone")).toBe("Time unavailable");
  });
});
