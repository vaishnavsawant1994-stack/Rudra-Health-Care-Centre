import { describe, expect, it } from "vitest";
import { getTaskRelationshipReferenceTypes } from "./task-reference-permissions";

describe("task relationship reference permissions", () => {
  it("exposes only relationship references covered by read grants", () => {
    expect(getTaskRelationshipReferenceTypes([{ key: "corporate.read" }, { key: "doctors.read" }])).toEqual([
      "CORPORATE_RELATIONSHIP",
      "DOCTOR_RELATIONSHIP",
    ]);
  });

  it("does not infer read access from manage or unrelated grants", () => {
    expect(getTaskRelationshipReferenceTypes([{ key: "partners.manage" }, { key: "tasks.create" }])).toEqual([]);
  });
});
