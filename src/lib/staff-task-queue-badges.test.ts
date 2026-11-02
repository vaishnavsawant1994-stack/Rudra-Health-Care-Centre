import { describe, expect, it } from "vitest";
import { getStaffTaskQueueBadges } from "./staff-task-queue-badges";

const now = new Date("2026-10-29T12:00:00.000Z");
const base = { taskType: "GENERAL", status: "AWAITING_APPROVAL", approvalStatus: "PENDING", dueAt: null, escalationDueAt: "2026-10-29T11:00:00.000Z", escalationProcessedAt: null };

describe("staff task queue badges", () => {
  it("labels a due but unprocessed approval escalation as overdue, not escalated", () => {
    expect(getStaffTaskQueueBadges(base, now)).toEqual(["Escalation overdue"]);
  });

  it("labels a processed pending escalation as escalated", () => {
    expect(getStaffTaskQueueBadges({ ...base, escalationProcessedAt: "2026-10-29T11:30:00.000Z" }, now)).toEqual(["Escalated"]);
  });

  it("does not show an escalation badge for a completed task", () => {
    expect(getStaffTaskQueueBadges({ ...base, status: "COMPLETED", approvalStatus: "APPROVED", escalationProcessedAt: "2026-10-29T11:30:00.000Z" }, now)).toEqual([]);
  });

  it("labels exception-review work distinctly from an escalation", () => {
    expect(getStaffTaskQueueBadges({ ...base, taskType: "EXCEPTION_REVIEW", status: "OPEN", approvalStatus: "NOT_REQUIRED", dueAt: "2026-10-29T11:00:00.000Z", escalationDueAt: null }, now)).toEqual(["Exception review overdue"]);
    expect(getStaffTaskQueueBadges({ ...base, taskType: "EXCEPTION_REVIEW", status: "OPEN", approvalStatus: "NOT_REQUIRED", dueAt: "2026-10-29T13:00:00.000Z", escalationDueAt: null }, now)).toEqual(["Exception review"]);
  });
});
