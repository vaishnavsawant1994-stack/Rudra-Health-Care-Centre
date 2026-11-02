import { describe, expect, it } from "vitest";
import { getEscalationTaskHref } from "./escalation-task-handoff";

const centreId = "11111111-1111-4111-8111-111111111111";
const escalationId = "22222222-2222-4222-8222-222222222222";
const grants = [
  { key: "escalations.read", centreId },
  { key: "tasks.create", centreId },
  { key: "workspace.read", centreId: null },
];

describe("escalation follow-up task handoff", () => {
  it("prefills only centre, opaque escalation reference, and task type", () => {
    const href = getEscalationTaskHref({ centreId, escalationId, grants });
    expect(href).toBe(`/tasks?centreId=${centreId}&referenceType=STAFF_ESCALATION&referenceId=${escalationId}&taskType=FOLLOW_UP`);
    expect(href).not.toContain("description");
  });

  it("requires both escalation visibility and same-centre task creation", () => {
    expect(getEscalationTaskHref({ centreId, escalationId, grants: grants.slice(1) })).toBeNull();
    expect(getEscalationTaskHref({ centreId, escalationId, grants: [grants[0], { key: "workspace.read", centreId: null }, { key: "tasks.create", centreId: "33333333-3333-4333-8333-333333333333" }] })).toBeNull();
  });

  it("accepts assigned-escalation visibility scoped to the matching centre", () => {
    expect(getEscalationTaskHref({ centreId, escalationId, grants: [{ key: "escalations.assigned.read", centreId }, ...grants.slice(1)] })).not.toBeNull();
    expect(getEscalationTaskHref({ centreId, escalationId, grants: [{ key: "escalations.assigned.read", centreId: "33333333-3333-4333-8333-333333333333" }, ...grants.slice(1)] })).toBeNull();
  });
});
