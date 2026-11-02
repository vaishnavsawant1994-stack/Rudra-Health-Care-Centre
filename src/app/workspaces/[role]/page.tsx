import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/components/admin/admin-shell";
import { CentreOperationsSummary } from "@/components/branch/centre-operations-summary";
import { AppointmentList, AppointmentTeamSchedule } from "@/components/appointments/appointment-workbench";
import { WalkInQueue } from "@/components/appointments/walk-in-queue";
import { CollectionOperations, DispatchDesk, SamplesDirectory } from "@/components/samples/sample-workbench";
import { FinanceWorkbench } from "@/components/finance/finance-workbench";
import { LeadFollowups, LeadsDirectory } from "@/components/leads/lead-workbench";
import { ReportWorkbench } from "@/components/reports/report-workbench";
import { RosterWorkbench } from "@/components/roster/roster-workbench";
import { TaskWorkbench } from "@/components/tasks/task-workbench";
import { EscalationWorkbench } from "@/components/escalations/escalation-workbench";
import { OrderDirectory } from "@/components/orders/order-workbench";
import { PatientList } from "@/components/patients/patient-workbench";
import { canReadTaskQueue, getRoleWorkspaceCapabilities, getRoleWorkspaceLinks, getRoleWorkspacePanels, roleWorkspaceDefinitions, usesDailyCollectionSchedule, type RoleWorkspaceKey } from "@/server/role-workspaces";
import { getTaskRelationshipReferenceTypes } from "@/lib/task-reference-permissions";
import { canViewAnyOperationsSummary } from "@/server/centre-operations-policy";

const roles = Object.keys(roleWorkspaceDefinitions) as RoleWorkspaceKey[];
export function generateStaticParams() { return roles.map((role) => ({ role })); }

export default async function RoleWorkspacePage({ params }: { params: Promise<{ role: string }> }) {
  const { role } = await params;
  if (!roles.includes(role as RoleWorkspaceKey)) notFound();
  const key = role as RoleWorkspaceKey;
  const definition = roleWorkspaceDefinitions[key];
  return <AdminShell permission="workspace.read" title={definition.title}>{(staff) => {
    const links = getRoleWorkspaceLinks(key, staff.grants);
    const panels = getRoleWorkspacePanels(key, staff.grants);
    const capabilities = getRoleWorkspaceCapabilities(staff.grants);
    const relationshipReferenceTypes = getTaskRelationshipReferenceTypes(staff.grants);
    return <>
      <section className="admin-card"><p className="eyebrow">Role workspace</p><h2>{definition.title}</h2><p>{definition.description}</p><p>Each destination rechecks your current session, MFA state, role and centre scope before showing records or accepting changes.</p></section>
      <section className="workspace-grid" aria-label={`${definition.title} links`}>{links.map(([href, label, , description]) => <Link className="workspace-card" href={href} key={href}><span className="workspace-card-title">{label}<span aria-hidden="true">→</span></span><span>{description}</span></Link>)}{links.length === 0 && <div className="admin-card"><h2>No permitted workflows</h2><p>Your current role has no access to the destinations in this workspace.</p></div>}</section>
      {panels.includes("patient_directory") && <section className="workspace-operations"><h2>Patient lookup and registration</h2><PatientList canCreate={capabilities.createPatient} /></section>}
      {panels.includes("assigned_appointments") && <section className="workspace-operations"><h2>My assigned appointments</h2><p>The appointment API restricts this queue to bookings assigned to your staff account.</p><AppointmentList /></section>}
      {panels.includes("confirmation_queue") && <section className="workspace-operations"><h2>Pending booking confirmations</h2><AppointmentList statusFilter="REQUESTED" canCreateBooking={capabilities.createAppointment} /></section>}
      {panels.includes("walk_in_queue") && <section className="workspace-operations"><h2>Walk-in booking requests</h2><p>Walk-ins are recorded as booking requests and remain subject to the normal confirmation workflow. No queue token or service completion is implied.</p><AppointmentList statusFilter="REQUESTED" sourceFilter="WALK_IN" canCreateBooking={capabilities.createAppointment} /></section>}
      {panels.includes("walk_in_tokens") && <section className="workspace-operations"><WalkInQueue grants={staff.grants} /></section>}
      {panels.includes("arrival_queue") && <section className="workspace-operations"><h2>Today’s arrivals</h2><AppointmentList awaitingArrival canCreateBooking={capabilities.createAppointment} /></section>}
      {panels.includes("appointment_schedule") && <section className="workspace-operations"><AppointmentTeamSchedule /></section>}
      {panels.includes("order_coordination") && <section className="workspace-operations"><h2>Pending diagnostic orders</h2><OrderDirectory showSummary={false} initialStatus="PENDING_VERIFICATION" canCreate={capabilities.createOrder} /></section>}
      {panels.includes("approval_queue") && <section className="workspace-operations"><h2>Pending task completion approvals</h2><TaskWorkbench staffId={staff.staffUserId} permissionGrants={staff.grants} canCreate={false} canUpdate={false} canApprove={true} canAssign={staff.grants.some((grant) => grant.key === "tasks.assign")} canFilterCentre={staff.grants.some((grant) => grant.key === "tasks.read")} initialFilter="AWAITING_APPROVAL" /></section>}
      {panels.includes("collection_work") && <section className="workspace-operations"><h2>{key === "manager" ? "Centre collection workload" : "My collection work"}</h2><CollectionOperations grants={staff.grants} showDailySchedule={usesDailyCollectionSchedule(key)} /></section>}
      {panels.includes("sample_handover") && <section className="workspace-operations"><h2>My collected samples awaiting Rudra receiving</h2><SamplesDirectory mode="handover" /></section>}
      {panels.includes("sample_receiving") && <section className="workspace-operations"><h2>Rudra sample receiving queue</h2><SamplesDirectory mode="receiving" grants={staff.grants} /></section>}
      {panels.includes("sample_exceptions") && <section className="workspace-operations"><h2>{key === "phlebotomist" ? "My sample exceptions" : "Centre sample exceptions"}</h2><SamplesDirectory mode="exceptions" grants={staff.grants} /></section>}
      {panels.includes("sample_dispatch") && <section className="workspace-operations"><h2>Sample packing and dispatch queue</h2><DispatchDesk grants={staff.grants} /></section>}
      {panels.includes("roster_workload") && <section className="workspace-operations"><h2>{key === "phlebotomist" ? "My roster and workload" : "Roster and workload"}</h2><RosterWorkbench sessionStaffId={staff.staffUserId} grants={staff.grants} /></section>}
      {panels.includes("finance_operations") && <section className="workspace-operations"><h2>{key === "reception" ? "Payment status overview" : key === "manager" ? "Centre financial operations" : "Financial operations"}</h2><FinanceWorkbench mode="dashboard" grants={staff.grants} /></section>}
      {panels.includes("sales_pipeline") && <section className="workspace-operations"><h2>My assigned enquiries and pipeline</h2><LeadsDirectory assignedStaffId={staff.staffUserId} /></section>}
      {panels.includes("sales_followups") && <section className="workspace-operations"><h2>{key === "reception" ? "Assigned enquiry callbacks" : "Assigned lead follow-ups"}</h2><LeadFollowups assignedStaffId={staff.staffUserId} /></section>}
      {panels.includes("report_followups") && <section className="workspace-operations"><h2>Report follow-up queue</h2><ReportWorkbench mode="followups" grants={staff.grants} staffId={staff.staffUserId} /></section>}
      {panels.includes("support_requests") && <section className="workspace-operations"><h2>{key === "reception" ? "Reception service issue intake and work queue" : "Support requests and service issues"}</h2><TaskWorkbench staffId={staff.staffUserId} permissionGrants={staff.grants} canRead={canReadTaskQueue(staff.grants)} canCreate={capabilities.createSupportTask} canUpdate={staff.grants.some((grant) => grant.key === "tasks.update")} canApprove={false} canAssign={staff.grants.some((grant) => grant.key === "tasks.assign" || grant.key === "tasks.support.manage")} canEscalate={staff.grants.some((grant) => grant.key === "escalations.create")} relationshipReferenceTypes={relationshipReferenceTypes} initialTaskType="SUPPORT_REQUEST" fixedTaskType="SUPPORT_REQUEST" /></section>}
      {panels.includes("staff_tasks") && <section className="workspace-operations"><h2>{key === "manager" || key === "owner" ? "Operational task queue" : key === "reception" ? "My reception follow-ups" : "My assigned tasks"}</h2><TaskWorkbench staffId={staff.staffUserId} permissionGrants={staff.grants} canCreate={staff.grants.some((grant) => grant.key === "tasks.create")} canUpdate={staff.grants.some((grant) => grant.key === "tasks.update")} canApprove={staff.grants.some((grant) => grant.key === "tasks.approve")} canAssign={staff.grants.some((grant) => grant.key === "tasks.assign")} canEscalate={staff.grants.some((grant) => grant.key === "escalations.create")} canFilterCentre={staff.grants.some((grant) => grant.key === "tasks.read")} relationshipReferenceTypes={relationshipReferenceTypes} initialTaskType={key === "reception" ? "FOLLOW_UP" : ""} /></section>}
      {panels.includes("escalation_work") && <section className="workspace-operations"><h2>Operational escalations</h2><EscalationWorkbench staffId={staff.staffUserId} grants={staff.grants} canCreate={staff.grants.some((grant) => grant.key === "escalations.create")} canRead={staff.grants.some((grant) => ["escalations.read", "escalations.assigned.read"].includes(grant.key))} canAssign={staff.grants.some((grant) => grant.key === "escalations.manage")} /></section>}
      {canViewAnyOperationsSummary(staff.grants) ? <CentreOperationsSummary /> : null}
    </>;
  }}</AdminShell>;
}


