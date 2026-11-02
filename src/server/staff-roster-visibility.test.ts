import { describe, expect, it } from "vitest";
import { canReadTeamRoster, teamRosterCentreScope } from "./staff-roster-visibility";

describe("staff roster visibility", () => {
  it("keeps basic roster access self-scoped", () => {
    expect(canReadTeamRoster([{ key: "roster.read", centreId: "centre-a" }], "centre-a")).toBe(false);
  });

  it("allows team visibility only with a centre or organization roster-management/audit grant", () => {
    expect(canReadTeamRoster([{ key: "roster.manage", centreId: "centre-a" }], "centre-a")).toBe(true);
    expect(canReadTeamRoster([{ key: "staff.read", centreId: null }], "centre-a")).toBe(true);
    expect(canReadTeamRoster([{ key: "roster.manage", centreId: "centre-b" }], "centre-a")).toBe(false);
  });

  it("preserves per-centre scope when team and personal visibility are combined", () => {
    const grants = [{ key: "roster.read", centreId: "centre-a" }, { key: "roster.read", centreId: "centre-b" }, { key: "roster.manage", centreId: "centre-a" }];
    expect(teamRosterCentreScope(grants)).toEqual(["centre-a"]);
    expect(canReadTeamRoster(grants, "centre-a")).toBe(true);
    expect(canReadTeamRoster(grants, "centre-b")).toBe(false);
  });
});
