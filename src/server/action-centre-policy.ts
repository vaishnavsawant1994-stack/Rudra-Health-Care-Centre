import type { PermissionGrant } from "@/server/permissions";

export function getActionCentreAccess(grants: readonly PermissionGrant[]) {
  const has = (key: string) => grants.some((grant) => grant.key === key);
  const operationalQueueKeys = ["appointments.read", "appointments.assigned.read", "orders.read", "collections.read", "samples.read", "samples.receive", "samples.dispatch", "finance.read", "leads.read", "reports.read", "roster.read"];
  return {
    tasks: has("tasks.read") || has("tasks.assigned.read"),
    taskManagement: has("tasks.read"),
    taskCreate: has("tasks.create"),
    taskUpdate: has("tasks.update"),
    taskApprove: has("tasks.approve"),
    taskAssign: has("tasks.assign"),
    escalations: has("escalations.read") || has("escalations.assigned.read"),
    escalationCreate: has("escalations.create"),
    escalationManage: has("escalations.manage"),
    operationalQueues: operationalQueueKeys.some(has),
    appointments: has("appointments.read") || has("appointments.assigned.read"),
    assignedAppointmentsOnly: !has("appointments.read") && has("appointments.assigned.read"),
    orders: has("orders.read"),
    collections: has("collections.read"),
    sampleRead: has("samples.read"),
    sampleReceive: has("samples.receive"),
    sampleDispatch: has("samples.dispatch"),
    finance: has("finance.read"),
    leads: has("leads.read"),
    reportFollowups: has("reports.read") && has("reports.followups.manage"),
    reports: has("reports.read"),
    leadFollowups: has("leads.read") && has("leads.followups.manage"),
    roster: has("roster.read"),
  };
}
