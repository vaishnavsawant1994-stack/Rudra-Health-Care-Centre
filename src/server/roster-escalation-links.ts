export type RosterConflictSource = { id: string; kind: "APPOINTMENT" | "COLLECTION" };
export type OpenEscalationSource = { id: string; sourceType: string; sourceId: string };

/** Match only active review escalations to the scheduling records on the visible conflict page. */
export function buildRosterConflictEscalationLinks(conflicts: readonly RosterConflictSource[], escalations: readonly OpenEscalationSource[]) {
  const allowed = new Set(conflicts.map((item) => `${item.kind === "APPOINTMENT" ? "APPOINTMENT" : "COLLECTION_JOB"}:${item.id}`));
  const links = new Map<string, string>();
  for (const escalation of escalations) {
    const key = `${escalation.sourceType}:${escalation.sourceId}`;
    if (allowed.has(key) && !links.has(key)) links.set(key, escalation.id);
  }
  return links;
}
