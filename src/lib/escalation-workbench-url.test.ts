import { describe, expect, it } from "vitest";
import { escalationAssigneesUrl } from "./escalation-workbench-url";

describe("escalation workbench API routes", () => {
  it("uses the escalation permission boundary for assignee candidates", () => {
    expect(escalationAssigneesUrl("centre/with space")).toBe("/api/escalations/assignees?centreId=centre%2Fwith%20space");
  });
});
