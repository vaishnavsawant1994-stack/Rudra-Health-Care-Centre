import { describe, expect, it } from "vitest";
import { parseTaskAssignmentFilter } from "@/server/task-queue-filter";

describe("task queue assignment filter", () => {
  it("supports the default queue and a self-only assigned view", () => {
    expect(parseTaskAssignmentFilter(null)).toBe("ALL");
    expect(parseTaskAssignmentFilter("")).toBe("ALL");
    expect(parseTaskAssignmentFilter("me")).toBe("ASSIGNED_TO_ME");
  });

  it("rejects arbitrary staff identifiers and unsupported filter values", () => {
    expect(parseTaskAssignmentFilter("staff-a")).toBeNull();
    expect(parseTaskAssignmentFilter("all")).toBeNull();
    expect(parseTaskAssignmentFilter("true")).toBeNull();
  });
});
