import type { PermissionGrant } from "@/server/permissions";

export type OwnerDashboardPanel = "operations" | "staffing" | "tasks" | "crm" | "finance" | "reports";

const operationsPermissions = ["appointments.read", "appointments.assigned.read", "orders.read", "collections.read", "collections.assign", "samples.read", "samples.receive", "samples.dispatch", "samples.exceptions.manage", "leads.followups.manage", "reports.followups.manage", "tasks.read", "tasks.assigned.read", "escalations.read", "escalations.assigned.read", "roster.read", "roster.manage", "finance.read"];

export function getOwnerDashboardPanels(grants: readonly PermissionGrant[]): OwnerDashboardPanel[] {
  const has = (key: string) => grants.some((grant) => grant.key === key);
  const panels: OwnerDashboardPanel[] = [];
  if (operationsPermissions.some(has)) panels.push("operations");
  if (has("roster.read") || has("roster.manage")) panels.push("staffing");
  if (has("tasks.read") || has("tasks.assigned.read")) panels.push("tasks");
  if (has("leads.read")) panels.push("crm");
  if (has("finance.read")) panels.push("finance");
  if (has("reports.read") && has("reports.followups.manage")) panels.push("reports");
  return panels;
}
