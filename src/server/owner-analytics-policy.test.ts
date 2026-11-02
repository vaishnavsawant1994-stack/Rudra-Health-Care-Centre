import { describe, expect, it } from "vitest";
import { ownerAnalyticsBounds, ownerAnalyticsFilterSchema } from "./owner-analytics-policy";

describe("owner analytics filters", () => {
  it("requires valid ordered ISO dates and caps the range", () => {
    expect(ownerAnalyticsFilterSchema.safeParse({ from: "2026-10-01", to: "2026-10-31" }).success).toBe(true);
    expect(ownerAnalyticsFilterSchema.safeParse({ from: "2026-11-02", to: "2026-11-01" }).success).toBe(false);
    expect(ownerAnalyticsFilterSchema.safeParse({ from: "2025-10-30", to: "2026-11-01" }).success).toBe(false);
    expect(ownerAnalyticsFilterSchema.safeParse({ from: "2026-10-01", to: "2026-10-31", patientId: "not-supported" }).success).toBe(false);
  });

  it("uses an inclusive UTC end date by returning an exclusive next-day bound", () => {
    const bounds = ownerAnalyticsBounds("2026-10-31", "2026-11-01");
    expect(bounds.start.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(bounds.end.toISOString()).toBe("2026-11-02T00:00:00.000Z");
  });
});
