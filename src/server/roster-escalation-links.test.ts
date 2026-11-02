import { describe, expect, it } from "vitest";
import { buildRosterConflictEscalationLinks } from "./roster-escalation-links";

describe("roster conflict escalation links", () => {
  it("matches only active escalation sources for visible appointment and collection conflicts", () => {
    const links = buildRosterConflictEscalationLinks([
      { id: "appointment-1", kind: "APPOINTMENT" },
      { id: "collection-1", kind: "COLLECTION" },
    ], [
      { id: "esc-1", sourceType: "APPOINTMENT", sourceId: "appointment-1" },
      { id: "esc-2", sourceType: "COLLECTION_JOB", sourceId: "collection-1" },
      { id: "esc-3", sourceType: "LEAD", sourceId: "appointment-1" },
      { id: "esc-4", sourceType: "APPOINTMENT", sourceId: "other-appointment" },
    ]);

    expect(links.get("APPOINTMENT:appointment-1")).toBe("esc-1");
    expect(links.get("COLLECTION_JOB:collection-1")).toBe("esc-2");
    expect(links.size).toBe(2);
  });

  it("keeps the first deterministic match when duplicate open rows exist", () => {
    const links = buildRosterConflictEscalationLinks([{ id: "appointment-1", kind: "APPOINTMENT" }], [
      { id: "older", sourceType: "APPOINTMENT", sourceId: "appointment-1" },
      { id: "newer", sourceType: "APPOINTMENT", sourceId: "appointment-1" },
    ]);

    expect(links.get("APPOINTMENT:appointment-1")).toBe("older");
  });
});
