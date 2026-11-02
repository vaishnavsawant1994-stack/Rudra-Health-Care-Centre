import { describe, expect, it } from "vitest";
import { getVisibleWorkspaceGroups } from "./workspace-links";

const links = (grants: string[]) => getVisibleWorkspaceGroups(grants.map((key) => ({ key, centreId: "centre-a" }))).flatMap((group) => group.links.map((item) => item.href));

describe("staff workspace navigation", () => {
  it("shows only collection actions granted to a phlebotomist", () => {
    expect(links(["workspace.read", "collections.visit.record", "collections.read", "samples.read"])).toEqual([
      "/workspaces/phlebotomist", "/branch/operations", "/field/today", "/collections", "/samples",
    ]);
  });

  it("does not expose patient, finance, report, or owner links without those grants", () => {
    const visible = links(["workspace.read", "samples.read"]);
    expect(visible).toEqual(["/branch/operations", "/samples"]);
  });

  it("keeps unassigned staff at an empty state", () => {
    expect(getVisibleWorkspaceGroups([])).toEqual([]);
  });

  it("shows an Owner entry only when organization access is granted", () => {
    expect(links(["workspace.read", "audit.read"])).toContain("/owner/audit");
    expect(links(["workspace.read", "audit.read"])).not.toContain("/owner");
    expect(links(["workspace.read", "organization.read"])).toContain("/owner");
  });
});
