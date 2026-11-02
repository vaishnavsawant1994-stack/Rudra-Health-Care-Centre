/** Build an opaque, record-specific destination for an already-authorized work queue. */
export function centreFollowupHref(kind: "LEAD_FOLLOWUP" | "REPORT_FOLLOWUP", followupId: string, centreId: string) {
  const params = new URLSearchParams({ followupId, centreId });
  return kind === "LEAD_FOLLOWUP" ? `/leads/followups?${params}` : `/reports/followups?${params}`;
}
