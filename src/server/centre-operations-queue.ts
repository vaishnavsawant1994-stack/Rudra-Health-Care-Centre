export type OperationsQueueItem = { id: string; kind: string; title: string; reference: string; status: string; at: string; href: string };

type QueueMetrics = {
  appointmentsWithoutArrivalToday?: number;
  pendingConfirmations?: number;
  pendingWebsiteEnquiries?: number;
  openOrders?: number;
  financePendingPayments?: number;
  financeDisputes?: number;
  financeRefundRequests?: number;
  activeCollections?: number;
  pendingReceiving?: number;
  pendingDispatch?: number;
  openExceptions?: number;
  overdueLeadFollowups?: number;
  overdueReportFollowups?: number;
  openTasks?: number;
  taskApprovalExpiryDue?: number;
  taskApprovalEscalationDue?: number;
  openEscalations?: number;
};

const queueMetricByKind: Array<[string, keyof QueueMetrics, (metrics: QueueMetrics) => number]> = [
  ["APPOINTMENT_ARRIVAL", "appointmentsWithoutArrivalToday", (m) => m.appointmentsWithoutArrivalToday ?? 0],
  ["APPOINTMENT", "pendingConfirmations", (m) => m.pendingConfirmations ?? 0],
  ["WEBSITE_ENQUIRY", "pendingWebsiteEnquiries", (m) => m.pendingWebsiteEnquiries ?? 0],
  ["ORDER", "openOrders", (m) => m.openOrders ?? 0],
  ["FINANCE_PAYMENT", "financePendingPayments", (m) => m.financePendingPayments ?? 0],
  ["FINANCE_DISPUTE", "financeDisputes", (m) => m.financeDisputes ?? 0],
  ["FINANCE_REFUND", "financeRefundRequests", (m) => m.financeRefundRequests ?? 0],
  ["COLLECTION", "activeCollections", (m) => m.activeCollections ?? 0],
  ["SAMPLE_RECEIVING", "pendingReceiving", (m) => m.pendingReceiving ?? 0],
  ["SAMPLE_DISPATCH", "pendingDispatch", (m) => m.pendingDispatch ?? 0],
  ["SAMPLE_EXCEPTION", "openExceptions", (m) => m.openExceptions ?? 0],
  ["LEAD_FOLLOWUP", "overdueLeadFollowups", (m) => m.overdueLeadFollowups ?? 0],
  ["REPORT_FOLLOWUP", "overdueReportFollowups", (m) => m.overdueReportFollowups ?? 0],
  ["TASK", "openTasks", (m) => m.openTasks ?? 0],
  ["TASK_APPROVAL_EXPIRY", "taskApprovalExpiryDue", (m) => m.taskApprovalExpiryDue ?? 0],
  ["TASK_APPROVAL_ESCALATION", "taskApprovalEscalationDue", (m) => m.taskApprovalEscalationDue ?? 0],
  ["ESCALATION", "openEscalations", (m) => m.openEscalations ?? 0],
];

export function buildOperationsQueuePreview<T extends OperationsQueueItem>(items: T[], metrics: QueueMetrics, limitPerKind = 10, limitOverall = 50) {
  const perKind = new Map<string, T[]>();
  for (const item of items) perKind.set(item.kind, [...(perKind.get(item.kind) ?? []), item]);
  const fetched = [...perKind.values()].flatMap((group) => group.slice(0, limitPerKind));
  fetched.sort((a, b) => a.at.localeCompare(b.at) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
  const visible = fetched.slice(0, limitOverall);
  const visibleByKind = new Map<string, number>();
  for (const item of visible) visibleByKind.set(item.kind, (visibleByKind.get(item.kind) ?? 0) + 1);
  const omittedByKind: Record<string, number> = {};
  for (const [kind, metric, getTotal] of queueMetricByKind) {
    if (metrics[metric] === undefined) continue;
    const omitted = Math.max(0, getTotal(metrics) - (visibleByKind.get(kind) ?? 0));
    if (omitted > 0) omittedByKind[kind] = omitted;
  }
  return { items: visible, omittedByKind };
}
