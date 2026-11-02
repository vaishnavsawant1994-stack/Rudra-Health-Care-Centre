import { describe, expect, it } from "vitest";
import { buildOperationsQueuePreview, type OperationsQueueItem } from "./centre-operations-queue";
import { escalationDeepLinkHref } from "@/lib/escalation-deep-link";

const item = (kind: string, id: number): OperationsQueueItem => ({ id: `${kind}-${id}`, kind, title: kind, reference: `${id}`, status: "OPEN", at: new Date(Date.UTC(2026, 0, 1, 0, id)).toISOString(), href: "/queue" });

describe("centre operations queue preview", () => {
  it("provides an escalation-specific destination that can reopen its details", () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    expect(escalationDeepLinkHref(id)).toBe(`/escalations?escalationId=${id}`);
  });

  it("reports source items omitted by per-queue and combined preview limits", () => {
    const input = [...Array.from({ length: 12 }, (_, i) => item("TASK", i)), ...Array.from({ length: 4 }, (_, i) => item("ESCALATION", i))];
    const result = buildOperationsQueuePreview(input, { openTasks: 12, openEscalations: 4 }, 10, 11);
    expect(result.items).toHaveLength(11);
    expect(result.omittedByKind).toEqual({ TASK: 5 });
  });

  it("does not disclose hidden queue counts when the corresponding metric is not authorized", () => {
    const result = buildOperationsQueuePreview([item("TASK", 1)], {}, 10, 50);
    expect(result.omittedByKind).toEqual({});
  });

  it("reports exact omissions when a source has more work than its preview limit", () => {
    const input = Array.from({ length: 15 }, (_, i) => item("ORDER", i));
    const result = buildOperationsQueuePreview(input, { openOrders: 15 });
    expect(result.items).toHaveLength(10);
    expect(result.omittedByKind).toEqual({ ORDER: 5 });
  });
});
