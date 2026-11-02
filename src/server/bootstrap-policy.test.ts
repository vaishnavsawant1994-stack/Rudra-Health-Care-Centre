import { describe, expect, it } from "vitest";
import { mayBootstrapOwner } from "./bootstrap-policy.mjs";

describe("one-time owner bootstrap guard", () => {
  it("requires explicit confirmation and a clean database", () => {
    expect(mayBootstrapOwner({ authorized: true, databaseRecordCount: 0 })).toBe(true);
    expect(mayBootstrapOwner({ authorized: false, databaseRecordCount: 0 })).toBe(false);
    expect(mayBootstrapOwner({ authorized: true, databaseRecordCount: 1 })).toBe(false);
  });
});
