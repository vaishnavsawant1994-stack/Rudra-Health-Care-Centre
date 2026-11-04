export function collectionOperationsQuery(input: {
  page: number;
  pageSize: number;
  centreId: string;
  scheduleDate: string;
  includeScheduleDate: boolean;
}) {
  const params = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) });
  if (input.centreId) params.set("centreId", input.centreId);
  if (input.includeScheduleDate && input.scheduleDate) params.set("date", input.scheduleDate);
  return params;
}
