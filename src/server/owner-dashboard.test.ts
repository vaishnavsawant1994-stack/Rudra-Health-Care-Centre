import { describe, expect, it } from "vitest";
import { getOwnerDashboardPanels } from "@/server/owner-dashboard";

describe("owner dashboard permission projection", () => {
  it("shows no operational records to an organization-only session", () => {
    expect(getOwnerDashboardPanels([{ key: "organization.read", centreId: null }])).toEqual([]);
  });
  it("projects workbenches only from the session's current grants", () => {
    expect(getOwnerDashboardPanels([
      { key: "tasks.read", centreId: "centre-a" }, { key: "tasks.approve", centreId: "centre-a" }, { key: "leads.read", centreId: "centre-b" },
      { key: "finance.read", centreId: "centre-a" }, { key: "roster.manage", centreId: "centre-a" },
      { key: "reports.read", centreId: "centre-a" }, { key: "reports.followups.manage", centreId: "centre-a" },
    ])).toEqual(["operations", "staffing", "tasks", "crm", "finance", "reports"]);
  });
  it("requires both report grants for report follow-ups", () => {
    expect(getOwnerDashboardPanels([{ key: "reports.read", centreId: null }])).not.toContain("reports");
    expect(getOwnerDashboardPanels([{ key: "reports.followups.manage", centreId: null }])).not.toContain("reports");
  });
  it("does not create a task queue from an approval grant without task read scope", () => {
    expect(getOwnerDashboardPanels([{ key: "tasks.approve", centreId: "centre-a" }])).not.toContain("tasks");
  });
});
