import { describe, expect, it } from "vitest";
import { getBusinessRelationshipTaskHref } from "./business-relationship-task-handoff";

const centreId = "123e4567-e89b-42d3-a456-426614174000";
const relationshipId = "223e4567-e89b-42d3-a456-426614174000";

describe("business relationship task handoff", () => {
  it("creates a corporate follow-up link with only scoped opaque references", () => {
    const href = getBusinessRelationshipTaskHref({ type: "CORPORATE", centreId, relationshipId, grants: [
      { key: "tasks.create", centreId }, { key: "workspace.read", centreId },
    ] });
    expect(href).toBe(`/tasks?centreId=${centreId}&referenceType=CORPORATE_RELATIONSHIP&referenceId=${relationshipId}&taskType=FOLLOW_UP`);
    expect(href).not.toContain("name");
  });

  it("supports partner references and rejects missing or cross-centre task grants", () => {
    expect(getBusinessRelationshipTaskHref({ type: "PARTNER", centreId, relationshipId, grants: [
      { key: "tasks.create", centreId: null }, { key: "workspace.read", centreId: null },
    ] })).toContain("referenceType=PARTNER_RELATIONSHIP");
    expect(getBusinessRelationshipTaskHref({ type: "CORPORATE", centreId, relationshipId, grants: [
      { key: "tasks.create", centreId },
    ] })).toBeNull();
    expect(getBusinessRelationshipTaskHref({ type: "PARTNER", centreId, relationshipId, grants: [
      { key: "tasks.create", centreId: "323e4567-e89b-42d3-a456-426614174000" },
      { key: "workspace.read", centreId },
    ] })).toBeNull();
  });

  it("creates a doctor follow-up task link only when task creation is allowed at the same centre", () => {
    const grants = [{ key: "tasks.create", centreId }, { key: "workspace.read", centreId }, { key: "doctors.read", centreId }];
    expect(getBusinessRelationshipTaskHref({ type: "DOCTOR", centreId, relationshipId, grants })).toBe(`/tasks?centreId=${centreId}&referenceType=DOCTOR_RELATIONSHIP&referenceId=${relationshipId}&taskType=FOLLOW_UP`);
    expect(getBusinessRelationshipTaskHref({ type: "DOCTOR", centreId, relationshipId, grants: grants.filter((grant) => grant.key !== "workspace.read") })).toBeNull();
  });
});
