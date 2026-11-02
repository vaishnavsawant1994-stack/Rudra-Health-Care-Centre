import { describe, expect, it } from "vitest";
import { conversionRate, parseAnalyticsDate, summarizeLeadAnalytics } from "@/server/lead-analytics";

describe("lead analytics projections", () => {
  it("aggregates only known dimensions and orders the result deterministically", () => {
    expect(summarizeLeadAnalytics([{ key: "WEBSITE", count: 2 }, { key: "WEBSITE", count: 3 }, { key: "PRIVATE_NAME", count: 90 }, { key: "PHONE", count: -1 }], "source"))
      .toEqual([{ key: "WEBSITE", count: 5 }]);
  });
  it("computes conversion percentage without returning invalid or empty denominators", () => {
    expect(conversionRate(3, 1)).toBe(33.3);
    expect(conversionRate(0, 0)).toBeNull();
    expect(conversionRate(2, 3)).toBeNull();
  });
  it("accepts only real ISO calendar dates", () => {
    expect(parseAnalyticsDate("2026-10-31")?.toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(parseAnalyticsDate("2026-02-30")).toBeNull();
    expect(parseAnalyticsDate("31-10-2026")).toBeNull();
  });
});
