import { describe, expect, it } from "vitest";
import { resolveTaskWorkbenchPrefill } from "./task-workbench-prefill";

const centreId = "11111111-1111-4111-8111-111111111111";
const referenceId = "22222222-2222-4222-8222-222222222222";
const grants = [{ key: "tasks.create", centreId }, { key: "workspace.read", centreId: null }];
const allowed = ["DOCTOR_RELATIONSHIP"] as const;

describe("task workbench query prefill", () => {
  it("accepts only valid, authorized relationship prefill values", () => {
    expect(resolveTaskWorkbenchPrefill({ centreId, referenceType: "DOCTOR_RELATIONSHIP", referenceId, taskType: "FOLLOW_UP" }, grants, allowed)).toEqual({
      initialTaskId: undefined,
      initialCentreId: centreId,
      initialReferenceType: "DOCTOR_RELATIONSHIP",
      initialReferenceId: referenceId,
      initialTaskType: "FOLLOW_UP",
    });
  });

  it("does not prefill an ungranted centre or relationship type", () => {
    expect(resolveTaskWorkbenchPrefill({ centreId: referenceId, referenceType: "DOCTOR_RELATIONSHIP", referenceId }, grants, allowed)).toMatchObject({ initialCentreId: undefined, initialReferenceId: undefined });
    expect(resolveTaskWorkbenchPrefill({ centreId, referenceType: "DOCTOR_RELATIONSHIP", referenceId }, [{ key: "doctors.manage", centreId }, { key: "workspace.read", centreId: null }], allowed)).toMatchObject({ initialCentreId: undefined, initialReferenceId: undefined });
    expect(resolveTaskWorkbenchPrefill({ centreId, referenceType: "FINANCE_REFUND", referenceId }, grants, allowed)).toMatchObject({ initialReferenceType: undefined, initialReferenceId: undefined });
  });

  it("rejects malformed identifiers and ignores unsupported task types", () => {
    expect(resolveTaskWorkbenchPrefill({ taskId: "not-an-id", centreId: "bad", referenceType: "DOCTOR_RELATIONSHIP", referenceId: "bad", taskType: "REFUND" }, grants, allowed)).toEqual({
      initialTaskId: undefined,
      initialCentreId: undefined,
      initialReferenceType: "DOCTOR_RELATIONSHIP",
      initialReferenceId: undefined,
      initialTaskType: undefined,
    });
  });

  it("prefills an escalation only for readers scoped to the selected centre", () => {
    const escalationGrants = [...grants, { key: "escalations.assigned.read", centreId }];
    expect(resolveTaskWorkbenchPrefill({ centreId, referenceType: "STAFF_ESCALATION", referenceId, taskType: "FOLLOW_UP" }, escalationGrants, allowed)).toMatchObject({ initialCentreId: centreId, initialReferenceType: "STAFF_ESCALATION", initialReferenceId: referenceId, initialTaskType: "FOLLOW_UP" });
    expect(resolveTaskWorkbenchPrefill({ centreId, referenceType: "STAFF_ESCALATION", referenceId }, grants, allowed)).toMatchObject({ initialReferenceType: undefined, initialReferenceId: undefined });
  });
});
