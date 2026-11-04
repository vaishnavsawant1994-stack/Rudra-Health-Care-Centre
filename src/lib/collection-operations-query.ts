export function collectionOperationsQuery(input: {
  page: number;
  pageSize: number;
  centreId: string;
  scheduleDate: string;
  includeScheduleDate: boolean;
  assignedToMe?: boolean;
  visitStage?: "TRAVELLING" | "ARRIVED" | "STAGE_PENDING" | "";
}) {
  const params = new URLSearchParams({ page: String(input.page), pageSize: String(input.pageSize) });
  if (input.centreId) params.set("centreId", input.centreId);
  if (input.includeScheduleDate && input.scheduleDate) params.set("date", input.scheduleDate);
  if (input.assignedToMe) params.set("assignedToMe", "1");
  if (input.visitStage) params.set("visitStage", input.visitStage);
  return params;
}
