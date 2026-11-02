import { describe, expect, it } from "vitest";
import { sameTaskActionPrivateData, sameTaskCreatePrivateData, taskActionFingerprint, taskCreateFingerprint } from "@/server/staff-task-idempotency";

describe("staff task idempotency fingerprints", () => {
  it("does not fingerprint task title or description", () => {
    const first = { centreId: "centre", title: "Synthetic name A", description: "private note A", priority: "NORMAL" };
    const second = { ...first, title: "Synthetic name B", description: "private note B" };
    expect(taskCreateFingerprint(first)).toBe(taskCreateFingerprint(second));
    expect(sameTaskCreatePrivateData({ title: first.title, description: first.description }, first)).toBe(true);
    expect(sameTaskCreatePrivateData({ title: first.title, description: first.description }, second)).toBe(false);
  });

  it("does not fingerprint private action text and compares encrypted event snapshots", () => {
    const first = { action: "COMMENT", comment: "synthetic private comment", expectedVersion: 2 };
    const second = { ...first, comment: "different private comment" };
    expect(taskActionFingerprint("task", "actor", first)).toBe(taskActionFingerprint("task", "actor", second));
    expect(sameTaskActionPrivateData({ comment: first.comment, reason: null, title: null, description: null }, first)).toBe(true);
    expect(sameTaskActionPrivateData({ comment: first.comment, reason: null, title: null, description: null }, second)).toBe(false);
  });
});
