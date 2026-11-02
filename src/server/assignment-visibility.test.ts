import { describe, expect, it } from "vitest";
import { assignmentVisibility, assignmentVisibilityAtCentre } from "./assignment-visibility";

describe("assignment visibility by centre", () => {
  it("limits field staff with organization-wide read to assigned jobs outside assignment-management centres", () => {
    expect(assignmentVisibility([
      { key: "collections.read", centreId: null },
      { key: "collections.visit.record", centreId: null },
      { key: "collections.assign", centreId: "centre-a" },
    ], "collections.read", "collections.assign", "collections.visit.record")).toEqual({
      readCentres: null,
      restricted: true,
      unrestrictedCentres: ["centre-a"],
      assignedOnlyCentres: null,
    });
  });

  it("splits readable centres into assignment-managed and assigned-only scopes", () => {
    expect(assignmentVisibility([
      { key: "samples.read", centreId: "centre-a" },
      { key: "samples.read", centreId: "centre-b" },
      { key: "samples.collect", centreId: "centre-b" },
      { key: "collections.assign", centreId: "centre-a" },
    ], "samples.read", "collections.assign", "samples.collect")).toEqual({
      readCentres: ["centre-a", "centre-b"],
      restricted: true,
      unrestrictedCentres: ["centre-a"],
      assignedOnlyCentres: ["centre-b"],
    });
  });

  it("makes collection field staff assigned-only for sample reads without requiring a second field grant", () => {
    expect(assignmentVisibility([
      { key: "samples.read", centreId: null },
      { key: "collections.visit.record", centreId: null },
      { key: "collections.assign", centreId: "centre-a" },
    ], "samples.read", "collections.assign", ["samples.collect", "collections.visit.record"])).toEqual({
      readCentres: null,
      restricted: true,
      unrestrictedCentres: ["centre-a"],
      assignedOnlyCentres: null,
    });
  });

  it("does not restrict an organization-wide assignment manager", () => {
    expect(assignmentVisibility([
      { key: "collections.read", centreId: "centre-a" },
      { key: "collections.visit.record", centreId: "centre-a" },
      { key: "collections.assign", centreId: null },
    ], "collections.read", "collections.assign", "collections.visit.record")).toEqual({
      readCentres: ["centre-a"],
      restricted: false,
      unrestrictedCentres: null,
      assignedOnlyCentres: [],
    });
  });

  it("derives the same all, assigned-only and denied centre modes for linked work", () => {
    const visibility = assignmentVisibility([
      { key: "samples.read", centreId: null },
      { key: "collections.visit.record", centreId: null },
      { key: "collections.assign", centreId: "centre-a" },
    ], "samples.read", "collections.assign", ["samples.collect", "collections.visit.record"]);

    expect(assignmentVisibilityAtCentre(visibility, "centre-a")).toBe("all");
    expect(assignmentVisibilityAtCentre(visibility, "centre-b")).toBe("assigned");
    const centreScoped = assignmentVisibility([
      { key: "samples.read", centreId: "centre-a" },
      { key: "collections.visit.record", centreId: "centre-a" },
    ], "samples.read", "collections.assign", "collections.visit.record");
    expect(assignmentVisibilityAtCentre(centreScoped, "centre-a")).toBe("assigned");
    expect(assignmentVisibilityAtCentre(centreScoped, "centre-b")).toBe("none");
  });
});
