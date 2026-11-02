import { describe, expect, it } from "vitest";
import { filterPublicCentres } from "./public-centre-search";

const centres = [
  { id: "a", code: "RHC-A", name: "Synthetic Central", publicProfile: { serviceArea: "North Sample District" } },
  { id: "b", code: "RHC-B", name: "Synthetic West", publicProfile: { serviceArea: null } },
  { id: "c", code: "RHC-C", name: "Synthetic East", publicProfile: { serviceArea: "South Sample District" } },
];

describe("public centre search", () => {
  it("searches published service area text without dropping centre/name matches", () => {
    expect(filterPublicCentres(centres, "north").map((centre) => centre.id)).toEqual(["a"]);
    expect(filterPublicCentres(centres, "rhc-b").map((centre) => centre.id)).toEqual(["b"]);
  });

  it("service-area mode excludes centres without an explicitly published area", () => {
    expect(filterPublicCentres(centres, "", true).map((centre) => centre.id)).toEqual(["a", "c"]);
  });

  it("returns an empty result for unmatched terms", () => {
    expect(filterPublicCentres(centres, "not listed", true)).toEqual([]);
  });
});
