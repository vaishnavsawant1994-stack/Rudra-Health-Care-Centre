import { describe, expect, it } from "vitest";
import { taskWorkbenchInitialTypeFilter } from "./task-workbench-filters";

describe("taskWorkbenchInitialTypeFilter", () => {
  it("uses a fixed workbench type as the list filter", () => {
    expect(taskWorkbenchInitialTypeFilter("", "SUPPORT_REQUEST")).toBe("SUPPORT_REQUEST");
  });

  it("preserves a role's initial task filter when no fixed type is configured", () => {
    expect(taskWorkbenchInitialTypeFilter("FOLLOW_UP")).toBe("FOLLOW_UP");
  });

  it("leaves general task queues unfiltered", () => {
    expect(taskWorkbenchInitialTypeFilter("")).toBe("");
  });
});
