import Link from "next/link";
import { connection } from "next/server";
import { Suspense, type ReactNode } from "react";
import { getAccess, type AccessResult } from "@/server/access";
import type { StaffContext } from "@/server/access";
import { AccessState } from "@/components/admin/access-state";
import { StaffSignOut } from "@/components/auth/staff-sign-out";

const links = [["/staff/workspace", "Workspace"], ["/branch/operations", "Centre operations"], ["/quality/service", "Service quality"], ["/actions", "Action centre"], ["/tasks", "Staff tasks"], ["/escalations", "Escalations"], ["/tasks/approvals", "Task approvals"], ["/roster", "Staff roster"], ["/roster/handovers", "Shift handover"], ["/owner", "Owner dashboard"], ["/owner/website-content", "Website content"], ["/patients", "Patients"], ["/families", "Families"], ["/relationships/doctors", "Doctors & referrals"], ["/relationships/referrals", "Referral attribution"], ["/relationships/doctor-visits", "Doctor visit plans"], ["/relationships/corporate", "Corporate clients"], ["/relationships/partners", "Partners"], ["/leads", "Leads & CRM"], ["/staff/quotes", "Internal quote drafts"], ["/communications", "Communications inbox"], ["/leads/analytics", "CRM acquisition overview"], ["/leads/public-enquiries", "Website enquiries"], ["/leads/followups", "Follow-ups"], ["/appointments", "Appointments"], ["/appointments/calendar", "Calendar"], ["/appointments/team", "Staff schedule"], ["/appointments/home-collection", "Home collection"], ["/collections", "Collection operations"], ["/field/today", "My collection jobs"], ["/field/handover", "My sample handover"], ["/field/exceptions", "My collection exceptions"], ["/samples", "Samples"], ["/branch/receiving", "Sample receiving"], ["/branch/dispatch", "Sample dispatch"], ["/samples/exceptions", "Sample exceptions"], ["/samples/procedures", "Procedure references"], ["/catalogue/tests", "Diagnostic tests"], ["/catalogue/packages", "Packages"], ["/catalogue/import", "Catalogue import"], ["/catalogue/prices", "Price review"], ["/orders", "Diagnostic orders"], ["/orders/directory", "Orders directory"], ["/reports", "Reports"], ["/reports/followups", "Report follow-ups"], ["/finance", "Finance"], ["/owner/settings", "Organization"], ["/owner/centres", "Centres"], ["/owner/staff", "Staff directory"], ["/owner/roles", "Roles & permissions"], ["/owner/assignments", "Role assignments"], ["/owner/sessions", "Active sessions"], ["/owner/audit", "Audit activity"], ["/owner/system", "System setup"]];
links.splice(3, 0, ["/support/tickets", "Support requests"]);
links.push(["/manage", "Centre manager dashboard"], ["/manage/centres", "Centre directory"], ["/manage/capacity", "Service area & capacity"], ["/manage/roster", "Staffing & work allocation"], ["/manage/slas", "SLA governance"], ["/quality/incidents", "Quality incidents"], ["/quality/sops", "SOPs & training"], ["/inventory", "Inventory"], ["/inventory/purchasing", "Procurement"], ["/analytics/operations", "Operations analytics"], ["/analytics/business", "Business analytics"], ["/manage/audit", "Operations audit"], ["/manage/health", "Business continuity"]);
links.push(["/admin/users", "Users & staff"], ["/admin/access", "Roles & access control"], ["/admin/privacy", "Consent & privacy"], ["/admin/config", "System configuration"], ["/admin/integrations", "Metropolis configuration"], ["/admin/integration-events", "Integration event review"], ["/admin/catalogue", "Catalogue governance"], ["/admin/documents", "Document & issuer governance"], ["/admin/recovery", "Backup & recovery"], ["/admin/automation", "Automation governance"], ["/admin/releases", "Release acceptance"]);
links.splice(32, 0, ["/field/route", "My visit route"]);
links.splice(15, 0, ["/relationships/doctors/new", "Doctor onboarding"], ["/corporates", "Corporate accounts"], ["/corporates/new", "Corporate intake"], ["/relationships/pipeline", "B2B relationship pipeline"]);
links.push(["/marketing", "Social media & marketing"]);

type AdminShellProps = { permission: string; title: string; children?: ReactNode | ((staff: StaffContext) => ReactNode) };

export function getAccessFallbackPermissions(permission: string): string[] {
  if (permission === "appointments.read") return ["appointments.assigned.read"];
  if (permission === "tasks.read") return ["tasks.assigned.read", "tasks.support.read"];
  if (permission === "collections.read") return ["collections.visit.record"];
  return [];
}

export function canShowSupportQueueLink(grants: readonly { key: string }[]): boolean {
  return grants.some(({ key }) => ["tasks.read", "tasks.assigned.read", "tasks.support.read"].includes(key));
}

export async function resolveAdminAccess(permission: string, lookup: (permission: string) => Promise<AccessResult>): Promise<AccessResult> {
  let access = await lookup(permission);
  if (access.kind !== "denied") return access;
  for (const fallbackPermission of getAccessFallbackPermissions(permission)) {
    access = await lookup(fallbackPermission);
    if (access.kind !== "denied") return access;
  }
  return access;
}

async function AdminShellContent({ permission, title, children }: AdminShellProps) {
  // Session validation reads expiring, request-specific Better Auth state. Keep it
  // out of prerendering so Next's cache-components runtime never evaluates the
  // session clock as a build-time value.
  await connection();
  const access = await resolveAdminAccess(permission, getAccess);
  if (access.kind !== "allowed") return <AccessState access={access} title={title} />;
  const has = (permission: string) => access.staff.grants.some((grant) => grant.key === permission);
  const visibleLinks = links
    .filter(([href]) => href !== "/staff/workspace" || has("workspace.read"))
      .filter(([href]) => href !== "/actions" || (has("workspace.read") && ["tasks.read", "tasks.assigned.read", "escalations.read", "escalations.assigned.read", "appointments.read", "appointments.assigned.read", "orders.read", "collections.read", "samples.read", "samples.receive", "samples.dispatch", "finance.read", "leads.read", "reports.read", "roster.read"].some(has)))
    .filter(([href]) => href !== "/branch/operations" || (has("workspace.read") && ["appointments.read", "appointments.assigned.read", "orders.read", "collections.read", "collections.assign", "collections.visit.record", "samples.read", "samples.receive", "samples.dispatch", "samples.exceptions.manage", "leads.followups.manage", "reports.followups.manage", "tasks.read", "tasks.assigned.read", "tasks.support.read", "roster.read", "roster.manage", "finance.read"].some(has)))
    .filter(([href]) => href !== "/tasks" || ["tasks.read", "tasks.assigned.read"].some(has))
    .filter(([href]) => href !== "/tasks/approvals" || has("tasks.approve"))
    .filter(([href]) => href !== "/quality/service" || has("tasks.support.read"))
    .filter(([href]) => href !== "/support/tickets" || canShowSupportQueueLink(access.staff.grants))
    .filter(([href]) => href !== "/escalations" || ["escalations.read", "escalations.assigned.read"].some(has))
    .filter(([href]) => href !== "/roster" || ["roster.read", "roster.manage"].some(has))
    .filter(([href]) => href !== "/roster/handovers" || has("roster.handover"))
    .filter(([href]) => href !== "/owner" || has("organization.read"))
    .filter(([href]) => href !== "/owner/website-content" || has("website.content.manage"))
    .filter(([href]) => href !== "/marketing" || has("marketing.read"))
    .filter(([href]) => href !== "/owner/settings" || has("organization.read"))
    .filter(([href]) => href !== "/owner/centres" || has("centres.read"))
    .filter(([href]) => !href.startsWith("/owner/staff") || has("staff.read"))
    .filter(([href]) => href !== "/owner/roles" || has("roles.read"))
    .filter(([href]) => href !== "/owner/assignments" || has("assignments.read"))
    .filter(([href]) => href !== "/owner/sessions" || has("sessions.read"))
    .filter(([href]) => href !== "/owner/audit" || has("audit.read"))
    .filter(([href]) => href !== "/owner/system" || has("configuration.read"))
    .filter(([href]) => href !== "/manage" || has("workspace.read"))
    .filter(([href]) => href !== "/manage/centres" || has("centres.read"))
    .filter(([href]) => href !== "/manage/capacity" || has("centres.read"))
    .filter(([href]) => href !== "/manage/roster" || has("roster.read") || has("roster.manage"))
    .filter(([href]) => href !== "/manage/slas" || has("tasks.policy.manage"))
    .filter(([href]) => href !== "/quality/incidents" || has("tasks.support.read"))
    .filter(([href]) => href !== "/quality/sops" || has("configuration.read"))
    .filter(([href]) => href !== "/inventory" || has("configuration.read"))
    .filter(([href]) => href !== "/inventory/purchasing" || has("configuration.read"))
    .filter(([href]) => href !== "/analytics/operations" || has("organization.read"))
    .filter(([href]) => href !== "/analytics/business" || has("organization.read"))
    .filter(([href]) => href !== "/manage/audit" || has("audit.read"))
    .filter(([href]) => href !== "/manage/health" || has("configuration.read"))
    .filter(([href]) => href !== "/admin/users" || has("staff.read"))
    .filter(([href]) => href !== "/admin/access" || has("roles.read"))
    .filter(([href]) => href !== "/admin/privacy" || has("configuration.read"))
    .filter(([href]) => href !== "/admin/config" || has("configuration.read"))
    .filter(([href]) => href !== "/admin/integrations" || has("samples.read"))
    .filter(([href]) => href !== "/admin/integration-events" || has("samples.read"))
    .filter(([href]) => href !== "/admin/catalogue" || has("catalogue.price.verify"))
    .filter(([href]) => href !== "/admin/documents" || has("configuration.read"))
    .filter(([href]) => href !== "/admin/recovery" || has("configuration.read"))
    .filter(([href]) => href !== "/admin/automation" || has("configuration.manage"))
    .filter(([href]) => href !== "/admin/releases" || has("configuration.read"))
    .filter(([href]) => href !== "/patients" || has("patients.read"))
    .filter(([href]) => href !== "/families" || has("families.read"))
    .filter(([href]) => href !== "/relationships/doctors" || has("doctors.read"))
    .filter(([href]) => href !== "/relationships/doctors/new" || has("doctors.read"))
    .filter(([href]) => href !== "/relationships/referrals" || (has("leads.read") && ["doctors.read", "corporate.read", "partners.read"].some(has)))
    .filter(([href]) => href !== "/relationships/doctor-visits" || has("doctors.manage"))
    .filter(([href]) => href !== "/relationships/corporate" || has("corporate.read"))
    .filter(([href]) => !href.startsWith("/corporates") || has("corporate.read"))
    .filter(([href]) => href !== "/relationships/partners" || has("partners.read"))
    .filter(([href]) => href !== "/relationships/pipeline" || has("leads.read"))
    .filter(([href]) => href !== "/leads" || has("leads.read"))
    .filter(([href]) => href !== "/staff/quotes" || has("leads.read") && has("finance.read") && has("catalogue.read") && has("orders.create"))
    .filter(([href]) => href !== "/communications" || has("leads.read") || has("leads.followups.manage"))
    .filter(([href]) => href !== "/leads/analytics" || has("leads.read"))
    .filter(([href]) => href !== "/leads/public-enquiries" || has("leads.read"))
    .filter(([href]) => href !== "/leads/followups" || has("leads.followups.manage"))
    .filter(([href]) => !href.startsWith("/appointments") || has("appointments.read") || has("appointments.assigned.read"))
    .filter(([href]) => href !== "/appointments/team" || has("appointments.assign"))
    .filter(([href]) => !href.startsWith("/collections") || has("collections.read"))
    .filter(([href]) => href !== "/field/today" || has("collections.visit.record"))
    .filter(([href]) => href !== "/field/route" || has("collections.visit.record"))
    .filter(([href]) => href !== "/field/handover" || has("collections.visit.record"))
    .filter(([href]) => href !== "/field/exceptions" || has("collections.visit.record"))
    .filter(([href]) => !href.startsWith("/samples") || has("samples.read") || (href === "/samples/procedures" && has("samples.procedures.manage")))
    .filter(([href]) => href !== "/branch/receiving" || has("samples.receive"))
    .filter(([href]) => href !== "/branch/dispatch" || has("samples.dispatch"))
    .filter(([href]) => !href.startsWith("/catalogue") || has("catalogue.read") || (href === "/catalogue/import" && has("catalogue.import")) || (href === "/catalogue/prices" && has("catalogue.price.verify")))
    .filter(([href]) => !href.startsWith("/orders") || has("orders.read") || has("orders.create"))
    .filter(([href]) => !href.startsWith("/reports") || has("reports.read") || (href === "/reports/followups" && has("reports.followups.manage")))
    .filter(([href]) => !href.startsWith("/finance") || has("finance.read"));
  return <main className="inner-page admin-page"><div className="page-container"><p className="eyebrow">Rudra Health OS | Administration</p><h1>{title}</h1><p className="admin-identity">Signed in as {access.staff.displayName} | {access.staff.staffCode}<StaffSignOut /></p><nav className="admin-nav" aria-label="Administration">{visibleLinks.map(([href, label]) => <Link key={href} href={href}>{label}</Link>)}</nav>{typeof children === "function" ? children(access.staff) : children}</div></main>;
}

export function AdminShell(props: AdminShellProps) {
  return <Suspense fallback={<main className="inner-page"><div className="page-container"><p role="status">Checking secure access...</p></div></main>}><AdminShellContent {...props} /></Suspense>;
}
