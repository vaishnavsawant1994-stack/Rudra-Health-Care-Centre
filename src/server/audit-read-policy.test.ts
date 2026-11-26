import { describe, expect, it } from "vitest";
import { auditCentreScope } from "./audit-read-policy";

describe("audit centre read scope", () => {
  it("does not treat centre-scoped grants as organization-wide audit authority", () => {
    expect(auditCentreScope([{ key: "audit.read", centreId: "centre-a" }, { key: "audit.read", centreId: "centre-b" }])).toEqual({ allowed: false, centreIds: [] });
    expect(auditCentreScope([{ key: "audit.read", centreId: "centre-a" }], "centre-a")).toEqual({ allowed: false, centreIds: [] });
  });

  it("allows an organization-wide auditor to filter to one centre", () => {
    expect(auditCentreScope([{ key: "audit.read", centreId: null }], "centre-a")).toEqual({ allowed: true, centreIds: ["centre-a"] });
    expect(auditCentreScope([{ key: "audit.read", centreId: null }], "centre-b")).toEqual({ allowed: true, centreIds: ["centre-b"] });
  });

  it("keeps organization-wide audit grants organization-wide", () => {
    expect(auditCentreScope([{ key: "audit.read", centreId: null }])).toEqual({ allowed: true, centreIds: null });
    expect(auditCentreScope([{ key: "audit.read", centreId: null }], "centre-b")).toEqual({ allowed: true, centreIds: ["centre-b"] });
  });

  it("does not grant audit scope from unrelated permissions", () => {
    expect(auditCentreScope([{ key: "workspace.read", centreId: null }])).toEqual({ allowed: false, centreIds: [] });
  });
});
