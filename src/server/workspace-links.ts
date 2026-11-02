import type { PermissionGrant } from "@/server/permissions";

export type WorkspaceLink = { href: string; label: string; description: string; permissions: readonly string[] };
export type WorkspaceGroup = { title: string; links: readonly WorkspaceLink[] };

export const workspaceGroups: readonly WorkspaceGroup[] = [
  { title: "Role workspaces", links: [
    { href: "/workspaces/reception", label: "Reception workspace", description: "Patient registration, booking coordination and follow-ups.", permissions: ["patients.read", "appointments.read", "appointments.assigned.read"] },
    { href: "/workspaces/phlebotomist", label: "Phlebotomist workspace", description: "Assigned field collections, sample work and tasks.", permissions: ["collections.visit.record"] },
    { href: "/workspaces/manager", label: "Centre manager workspace", description: "Centre queues, staff coverage, task approvals and exceptions.", permissions: ["roster.manage", "tasks.approve", "collections.assign"] },
    { href: "/workspaces/accounts", label: "Accounts workspace", description: "Financial operations and assigned account tasks.", permissions: ["finance.read"] },
    { href: "/workspaces/sales", label: "Sales workspace", description: "Lead pipeline, follow-ups and sales tasks.", permissions: ["leads.read", "leads.followups.manage"] },
    { href: "/workspaces/support", label: "Support workspace", description: "Authorized enquiries, follow-ups and service tasks.", permissions: ["leads.read", "reports.followups.manage"] },
    { href: "/workspaces/owner", label: "Owner operations", description: "Cross-centre overview, staff administration and audit.", permissions: ["organization.read"] },
    { href: "/owner/analytics", label: "Operational analytics", description: "Review date-filtered aggregate record counts within authorized centre and module scope.", permissions: ["organization.read"] },
  ] },
  { title: "Staff operations", links: [
    { href: "/marketing/campaigns", label: "Campaign attribution", description: "Manage internal campaign records and CRM attribution; publishing, messaging and ad spend stay disabled.", permissions: ["marketing.read"] },
    { href: "/marketing/content", label: "Marketing content calendar", description: "Draft, review and plan internal content; no publishing or message delivery is enabled.", permissions: ["marketing.read"] },
    { href: "/tasks", label: "Tasks and approvals", description: "Work on assigned centre tasks and review permitted completion requests.", permissions: ["tasks.read", "tasks.assigned.read", "tasks.create"] },
    { href: "/roster", label: "Staff roster", description: "Review centre shift coverage and manage schedules where authorized.", permissions: ["roster.read", "roster.manage"] },
  ] },
  { title: "Patient and reception work", links: [
    { href: "/patients", label: "Patient directory", description: "Find or register patients in your permitted centre scope.", permissions: ["patients.read", "patients.create"] },
    { href: "/leads", label: "Leads and enquiries", description: "Review enquiries, contact permissions and follow-ups.", permissions: ["leads.read", "leads.create"] },
    { href: "/appointments", label: "Appointments", description: "Review bookings and perform permitted scheduling actions.", permissions: ["appointments.read", "appointments.assigned.read", "appointments.create"] },
    { href: "/orders", label: "Diagnostic orders", description: "Review or create orders using the approved catalogue state.", permissions: ["orders.read", "orders.create"] },
    { href: "/finance", label: "Finance", description: "Open centre-scoped charges and payment records.", permissions: ["finance.read", "finance.payment.record"] },
  ] },
  { title: "Collection and branch operations", links: [
    { href: "/branch/operations", label: "Centre operations overview", description: "See permission-scoped centre queues without patient details.", permissions: ["appointments.read", "appointments.assigned.read", "orders.read", "collections.read", "collections.assign", "collections.visit.record", "samples.read", "samples.receive", "samples.dispatch", "samples.exceptions.manage", "leads.followups.manage", "reports.followups.manage", "finance.read"] },
    { href: "/field/today", label: "My collection jobs", description: "Open assigned field work and record permitted visit events.", permissions: ["collections.visit.record"] },
    { href: "/collections", label: "Collection operations", description: "Review collection work within your centre grants.", permissions: ["collections.read", "collections.assign"] },
    { href: "/samples", label: "Samples", description: "Open sample records available to your role.", permissions: ["samples.read", "samples.collect"] },
    { href: "/branch/receiving", label: "Sample receiving", description: "Reconcile samples received by an authorized branch.", permissions: ["samples.receive"] },
    { href: "/branch/dispatch", label: "Dispatch register", description: "Record and review authorized handovers.", permissions: ["samples.dispatch"] },
  ] },
  { title: "Reports and administration", links: [
    { href: "/reports", label: "Reports", description: "Review report intake and release state permitted for your role.", permissions: ["reports.read", "reports.register"] },
    { href: "/reports/followups", label: "Report follow-ups", description: "Work internal follow-up tasks without sending external messages.", permissions: ["reports.followups.manage"] },
    { href: "/catalogue/tests", label: "Diagnostic catalogue", description: "Review service records and their verification state.", permissions: ["catalogue.read", "catalogue.manage"] },
    { href: "/owner", label: "Owner administration", description: "Open organization controls available to your account.", permissions: ["organization.read"] },
    { href: "/owner/audit", label: "Audit activity", description: "Review authorized operational audit history.", permissions: ["audit.read"] },
  ] },
];

export function getVisibleWorkspaceGroups(grants: readonly PermissionGrant[]) {
  return workspaceGroups.map((group) => ({ ...group, links: group.links.filter((item) => item.permissions.some((permission) => grants.some((grant) => grant.key === permission))) })).filter((group) => group.links.length > 0);
}
