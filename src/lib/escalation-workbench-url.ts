export function escalationAssigneesUrl(centreId: string) {
  return `/api/escalations/assignees?centreId=${encodeURIComponent(centreId)}`;
}
