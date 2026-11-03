import type { PermissionGrant } from "@/server/permissions";

export const roleWorkspaceDefinitions = {
  reception: { title: "Reception workspace", description: "Patient registration, booking coordination and front-desk follow-up.", links: [
    ["/roster/handovers", "Shift handover", "roster.handover", "Record outstanding work and hand it to the next authorized staff member."],
    ["/patients", "Patient search and registration", "patients.read", "Find a patient or open the authorized registration workflow."],
    ["/appointments/new?source=WALK_IN", "Coordinate a walk-in", "appointments.create", "Register/select the patient and record the walk-in as a booking request for staff confirmation."],
    ["/appointments", "Appointment queue", "appointments.read", "Review bookings and use permitted appointment actions."],
    ["/leads", "Enquiries and callbacks", "leads.read", "Work contact-permitted enquiries and CRM follow-ups."],
    ["/tasks", "My tasks", "tasks.assigned.read", "Review tasks assigned to your staff account."],
  ] },
  phlebotomist: { title: "Phlebotomist workspace", description: "Field assignments, collection progress and sample handover.", links: [
    ["/roster/handovers", "Shift handover", "roster.handover", "Record and acknowledge shift responsibility handovers."],
    ["/field/today", "My collection assignments", "collections.visit.record", "Open assigned jobs and record authorized visit events."],
    ["/samples", "My sample work", "samples.read", "Review sample records within your role and centre scope."],
    ["/tasks", "My tasks", "tasks.assigned.read", "Review operational tasks assigned to you."],
  ] },
  manager: { title: "Centre manager workspace", description: "Centre queues, staff coverage, tasks and operational exceptions.", links: [
    ["/quality/service", "Service quality", "tasks.support.read", "Review centre-scoped service issue workload and recorded outcomes."],
    ["/roster/handovers", "Shift handover", "roster.handover", "Monitor and manage staff handovers within authorized centres."],
    ["/branch/operations", "Centre operations", "appointments.read", "Review permission-scoped centre queues."],
    ["/roster", "Roster and availability", "roster.read", "Review shift coverage and manage schedules if authorized."],
    ["/tasks", "Staff tasks", "tasks.read", "Assign and review work within centre permissions."],
    ["/tasks/approvals", "Supervisor approvals", "tasks.approve", "Review completion requests and record a reasoned decision."],
    ["/tasks/approvals/policies", "Centre task approval policy", "tasks.policy.manage", "Configure task-completion approval and escalation rules for permitted centres."],
    ["/escalations", "Operational escalations", "escalations.read", "Review and manage centre escalations within your role and centre scope."],
    ["/collections", "Collection workload", "collections.read", "Monitor collection jobs within assigned centres."],
    ["/branch/receiving", "Sample receiving queue", "samples.receive", "Reconcile expected specimens at Rudra within authorized centres."],
    ["/branch/dispatch", "Sample dispatch queue", "samples.dispatch", "Prepare authorized dispatch batches and record evidence-backed handover."],
    ["/samples/exceptions", "Sample exceptions", "samples.read", "Review sample exceptions without changing clinical policy."],
    ["/reports/followups", "Report follow-ups", "reports.followups.manage", "Monitor internal report follow-up tasks within your permitted centres."],
  ] },
  accounts: { title: "Accounts workspace", description: "Centre financial records and assigned operational tasks.", links: [
    ["/roster/handovers", "Shift handover", "roster.handover", "Hand over account work using protected notes and an explicit acknowledgment."],
    ["/finance", "Financial overview", "finance.read", "Review permitted centre finance activity and recent ledger records."],
    ["/finance/payments", "Payments directory", "finance.read", "Review payment status and follow authorized payment workflows."],
    ["/finance/outstanding", "Outstanding balances", "finance.read", "Review open charge balances within authorized centres."],
    ["/finance/exceptions", "Financial exceptions", "finance.read", "Review disputed payments and refund requests awaiting action."],
    ["/finance/refunds", "Refund requests", "finance.read", "Request or review refunds; separate approval and execution grants remain required."],
    ["/finance/reconciliation", "Centre cash reconciliation", "finance.read", "Review daily cash sessions and reconcile only where authorized."],
    ["/tasks", "Assigned tasks", "tasks.assigned.read", "Work assigned account operations tasks."],
  ] },
  sales: { title: "Sales workspace", description: "Enquiries, lead progression and assigned follow-ups.", links: [
    ["/relationships/doctors", "Doctor relationships", "doctors.read", "Review doctor relationships and permitted referral activity."],
    ["/relationships/corporate", "Corporate clients", "corporate.read", "Manage authorized corporate relationship records and activity."],
    ["/relationships/partners", "Referral partners", "partners.read", "Manage authorized partner relationship records and activity."],
    ["/relationships/referrals", "Referral attribution", "leads.read", "Review centre-scoped lead and recorded-conversion counts when relationship access overlaps."],
    ["/roster/handovers", "Shift handover", "roster.handover", "Hand over open work with an explicit receiving staff acknowledgment."],
    ["/leads", "Leads and pipeline", "leads.read", "Manage enquiries within assigned centre permissions."],
    ["/leads/analytics", "CRM acquisition overview", "leads.read", "Review aggregate lead volume and conversion within authorized centres."],
    ["/leads/public-enquiries", "Website enquiries", "leads.read", "Review public submissions before creating a CRM lead."],
    ["/leads/followups", "Lead follow-ups", "leads.followups.manage", "Work due callbacks while respecting contact restrictions."],
    ["/tasks", "Sales tasks", "tasks.assigned.read", "Review assigned operational tasks."],
    ["/escalations", "Assigned escalations", "escalations.assigned.read", "Review escalations assigned to your account."],
  ] },
  support: { title: "Support workspace", description: "Patient enquiries, permitted follow-ups and service tasks.", links: [
    ["/quality/service", "Service quality and issues", "tasks.support.read", "Review assigned centre-scoped issues and record verified operational outcomes."],
    ["/roster/handovers", "Shift handover", "roster.handover", "Hand over open support work to an authorized receiving staff member."],
    ["/leads", "Enquiries", "leads.read", "Review authorized enquiries and communication preferences."],
    ["/leads/public-enquiries", "Website enquiries", "leads.read", "Review public submissions before creating a CRM lead."],
    ["/reports/followups", "Report follow-up queue", "reports.followups.manage", "Coordinate internal follow-up without sending external messages."],
    ["/tasks", "Support tasks", "tasks.assigned.read", "Review tasks assigned to your support account."],
    ["/escalations", "Assigned escalations", "escalations.assigned.read", "Review assigned service escalations."],
  ] },
  owner: { title: "Owner operations workspace", description: "Organization oversight, centre performance and authorized approvals.", links: [
    ["/quality/service", "Service quality", "tasks.support.read", "Review service issue workload across centres covered by your grants."],
    ["/roster/handovers", "Shift handover", "roster.handover", "Review staff handovers and acknowledgments in permitted centres."],
    ["/branch/operations", "Cross-centre operations", "organization.read", "Review operations overview within owner permissions."],
    ["/owner", "Owner dashboard", "organization.read", "Open organization-level controls."],
    ["/leads/analytics", "CRM acquisition overview", "leads.read", "Review aggregate lead volume and conversion across authorized centres."],
    ["/relationships/corporate", "Corporate relationships", "corporate.read", "Review corporate records within authorized centres."],
    ["/relationships/partners", "Partner relationships", "partners.read", "Review partner records within authorized centres."],
    ["/owner/staff", "Staff and role management", "staff.read", "Review staff status and role assignments."],
    ["/owner/audit", "Audit activity", "audit.read", "Review immutable authorized audit events."],
    ["/tasks", "Task oversight", "tasks.read", "Review centre task queues."],
    ["/tasks/approvals", "Supervisor approvals", "tasks.approve", "Review completion requests and decision history."],
    ["/escalations", "Operational escalations", "escalations.read", "Monitor and manage escalations across permitted centres."],
    ["/tasks/approvals/policies", "Approval policy configuration", "tasks.policy.manage", "Configure operational task-completion approval and escalation rules."],
    ["/roster", "Staff roster", "roster.read", "Review staffing schedules across permitted centres."],
    ["/reports/followups", "Report follow-ups", "reports.followups.manage", "Monitor report follow-up tasks across centres covered by your grants."],
  ] },
} as const;

export type RoleWorkspaceKey = keyof typeof roleWorkspaceDefinitions;
export function canReadTaskQueue(grants: readonly PermissionGrant[]) {
  return grants.some((grant) => ["tasks.read", "tasks.assigned.read", "tasks.support.read"].includes(grant.key));
}

export function usesDailyCollectionSchedule(key: RoleWorkspaceKey) {
  return key === "phlebotomist";
}

/**
 * Several workbenches need two separate permissions. Only surface them when
 * the grants overlap in at least one centre (or an organization grant covers
 * every centre); the APIs remain the final authorization boundary.
 */
export function hasOverlappingPermissionScope(grants: readonly PermissionGrant[], requiredKeys: readonly string[]) {
  if (requiredKeys.length === 0) return true;
  if (requiredKeys.some((key) => !grants.some((grant) => grant.key === key))) return false;
  const centres = [...new Set(grants.filter((grant) => requiredKeys.includes(grant.key) && grant.centreId !== null).map((grant) => grant.centreId!))];
  const candidates: Array<string | null> = centres.length ? centres : [null];
  return candidates.some((centreId) => requiredKeys.every((key) =>
    grants.some((grant) => grant.key === key && (grant.centreId === null || grant.centreId === centreId)),
  ));
}

export function getRoleWorkspaceCapabilities(grants: readonly PermissionGrant[]) {
  return {
    createPatient: hasOverlappingPermissionScope(grants, ["patients.read", "patients.create"]),
    createAppointment: hasOverlappingPermissionScope(grants, ["appointments.read", "appointments.create"]),
    manageWalkIn: hasOverlappingPermissionScope(grants, ["appointments.read", "appointments.update"]),
    createOrder: hasOverlappingPermissionScope(grants, ["orders.read", "orders.create"]),
    createSupportTask: hasOverlappingPermissionScope(grants, ["tasks.create", "tasks.support.create"]),
  };
}

export function getRoleWorkspaceLinks(key: RoleWorkspaceKey, grants: readonly PermissionGrant[]) {
  return roleWorkspaceDefinitions[key].links.filter(([href, , permission]) => {
    if (href === "/reports/followups") return hasOverlappingPermissionScope(grants, ["reports.read", "reports.followups.manage"]);
    if (href === "/leads/followups") return hasOverlappingPermissionScope(grants, ["leads.read", "leads.followups.manage"]);
    if (href === "/relationships/referrals") return ["doctors.read", "corporate.read", "partners.read"].some((permission) => hasOverlappingPermissionScope(grants, ["leads.read", permission]));
    // Approval authority does not make a user's task list visible. The current
    // approval queue is centre-wide and therefore requires its explicit reader grant.
    if (href === "/tasks/approvals") return hasOverlappingPermissionScope(grants, ["tasks.approve", "tasks.read"]);
    return grants.some((grant) => grant.key === permission);
  });
}

export type RoleWorkspacePanel = "patient_directory" | "public_enquiries" | "arrival_queue" | "confirmation_queue" | "assigned_appointments" | "appointment_schedule" | "walk_in_queue" | "walk_in_tokens" | "order_coordination" | "sample_receiving" | "sample_handover" | "sample_dispatch" | "sample_exceptions" | "approval_queue" | "collection_work" | "roster_workload" | "finance_operations" | "sales_pipeline" | "sales_followups" | "report_followups" | "support_requests" | "staff_tasks" | "escalation_work";
export function getRoleWorkspacePanels(key: RoleWorkspaceKey, grants: readonly PermissionGrant[]): RoleWorkspacePanel[] {
  const has = (permission: string) => grants.some((grant) => grant.key === permission);
  const panels: RoleWorkspacePanel[] = [];
  if (key === "reception" && has("patients.read")) panels.push("patient_directory");
  if (key === "reception" && has("leads.read")) panels.push("public_enquiries");
  if (!has("appointments.read") && has("appointments.assigned.read")) panels.push("assigned_appointments");
  if ((key === "reception" || key === "manager") && has("appointments.read")) panels.push("confirmation_queue", "arrival_queue", "appointment_schedule");
  if ((key === "reception" || key === "manager") && has("appointments.read")) panels.push("walk_in_queue");
  if ((key === "reception" || key === "manager") && getRoleWorkspaceCapabilities(grants).manageWalkIn) panels.push("walk_in_tokens");
  if ((key === "reception" || key === "manager") && has("orders.read")) panels.push("order_coordination");
  if (key === "manager" && has("samples.receive")) panels.push("sample_receiving");
  if (key === "manager" && has("samples.dispatch")) panels.push("sample_dispatch");
  if (key === "phlebotomist" && has("samples.read")) panels.push("sample_handover");
  if ((key === "phlebotomist" || key === "manager") && has("samples.read")) panels.push("sample_exceptions");
  // Field staff can read their own assigned collection queue through the
  // visit-record grant; requiring the centre-wide reader grant hid the same
  // workbench that /field/today already exposes to them.
  if ((key === "phlebotomist" && (has("collections.read") || has("collections.visit.record"))) || (key === "manager" && has("collections.read"))) panels.push("collection_work");
  if ((key === "manager" || key === "phlebotomist") && has("roster.read")) panels.push("roster_workload");
  if ((key === "accounts" || key === "reception" || key === "manager" || key === "owner") && has("finance.read")) panels.push("finance_operations");
  if (key === "sales" && has("leads.read")) panels.push("sales_pipeline");
  if ((key === "sales" || key === "reception") && hasOverlappingPermissionScope(grants, ["leads.read", "leads.followups.manage"])) panels.push("sales_followups");
  if ((key === "support" || key === "manager" || key === "owner") && hasOverlappingPermissionScope(grants, ["reports.read", "reports.followups.manage"])) panels.push("report_followups");
  if ((key === "support" || key === "reception") && (has("tasks.support.read") || has("tasks.assigned.read") || hasOverlappingPermissionScope(grants, ["tasks.create", "tasks.support.create"]))) panels.push("support_requests");
  if ((key === "manager" || key === "owner") && has("tasks.support.read")) panels.push("support_requests");
  if (has("escalations.read") || has("escalations.assigned.read")) panels.push("escalation_work");
  if ((key === "manager" || key === "owner") && hasOverlappingPermissionScope(grants, ["tasks.approve", "tasks.read"])) panels.push("approval_queue");
  // Reception uses the same assigned-task API for operational follow-ups. The
  // API remains responsible for limiting this queue to assigned/scoped tasks.
  if (has("tasks.assigned.read") || has("tasks.read")) panels.push("staff_tasks");
  return panels;
}
