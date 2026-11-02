import { describe, expect, it } from "vitest";
import { parseRelationshipAttributionRange } from "./relationship-attribution-range";

describe("relationship attribution date range", () => {
  it("allows lifetime metrics when both bounds are omitted", () => {
    expect(parseRelationshipAttributionRange(null, null)).toEqual({ from: null, toExclusive: null });
  });
  it("includes the entire selected end date using a UTC-exclusive bound", () => {
    expect(parseRelationshipAttributionRange("2026-10-01", "2026-10-31")).toEqual({ from: new Date("2026-10-01T00:00:00.000Z"), toExclusive: new Date("2026-11-01T00:00:00.000Z") });
  });
  it.each([["2026-02-30", "2026-03-01"], ["2026-03-02", "2026-03-01"], ["2025-10-31", "2026-11-01"], ["2026-01-01", null], ["bad", "2026-01-02"]] as const)("rejects invalid or overlong range %s to %s", (from, to) => {
    expect(parseRelationshipAttributionRange(from, to)).toBeNull();
  });
});
