import { describe, expect, it } from "vitest";
import { canApproveTaskInCentre, canAssignTaskInCentre, canEscalateTaskInCentre, canUpdateTask } from "./task-permissions";

describe("task workbench centre-scoped capabilities", () => {
  it("does not carry task controls from one centre into another", () => {
    const grants = [
      { key: "tasks.update", centreId: "centre-a" },
      { key: "tasks.assign", centreId: "centre-a" },
      { key: "tasks.approve", centreId: "centre-a" },
      { key: "escalations.create", centreId: "centre-a" },
      { key: "tasks.read", centreId: "centre-a" },
    ];
    expect(canUpdateTask(grants, "centre-a", "other-staff", "manager")).toBe(true);
    expect(canAssignTaskInCentre(grants, "centre-a")).toBe(true);
    expect(canApproveTaskInCentre(grants, "centre-a")).toBe(true);
    expect(canEscalateTaskInCentre(grants, "centre-a")).toBe(true);
    expect(canUpdateTask(grants, "centre-b", "other-staff", "manager")).toBe(false);
    expect(canAssignTaskInCentre(grants, "centre-b")).toBe(false);
    expect(canApproveTaskInCentre(grants, "centre-b")).toBe(false);
    expect(canEscalateTaskInCentre(grants, "centre-b")).toBe(false);
  });

  it("preserves organization grants, assigned-worker edits, and support-manager scope", () => {
    const organization = [{ key: "tasks.update", centreId: null }, { key: "tasks.read", centreId: null }];
    expect(canUpdateTask(organization, "centre-b", "other", "manager")).toBe(true);
    const worker = [{ key: "tasks.update", centreId: "centre-a" }];
    expect(canUpdateTask(worker, "centre-a", "worker", "worker")).toBe(true);
    expect(canUpdateTask(worker, "centre-a", "other", "worker")).toBe(false);
    const support = [{ key: "tasks.update", centreId: "centre-a" }, { key: "tasks.support.manage", centreId: "centre-a" }];
    expect(canUpdateTask(support, "centre-a", "other", "support", "SUPPORT_REQUEST")).toBe(true);
    expect(canUpdateTask(support, "centre-b", "other", "support", "SUPPORT_REQUEST")).toBe(false);
    expect(canAssignTaskInCentre(support, "centre-a", "SUPPORT_REQUEST")).toBe(true);
    expect(canAssignTaskInCentre(support, "centre-a", "GENERAL")).toBe(false);
  });
});
