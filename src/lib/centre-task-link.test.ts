import { describe, expect, it } from "vitest";
import { centreTaskHref } from "./centre-task-link";

describe("centre operations task links", () => {
  it("preserves the exact task and centre when opening the staff task workbench", () => {
    expect(centreTaskHref("task-id", "centre-id")).toBe("/tasks?taskId=task-id&centreId=centre-id");
  });

  it.each(["expiry-due", "escalation-due"] as const)("preserves approval queue %s with its task and centre", (queue) => {
    expect(centreTaskHref("task-id", "centre-id", queue)).toBe(`/tasks/approvals?queue=${queue}&taskId=task-id&centreId=centre-id`);
  });

  it("encodes opaque IDs", () => {
    expect(centreTaskHref("task/id", "centre?id")).toBe("/tasks?taskId=task%2Fid&centreId=centre%3Fid");
  });
});
