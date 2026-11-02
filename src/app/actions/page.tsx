import { AdminShell } from "@/components/admin/admin-shell";
import { TaskWorkbench } from "@/components/tasks/task-workbench";
import { EscalationWorkbench } from "@/components/escalations/escalation-workbench";
import { AppointmentList } from "@/components/appointments/appointment-workbench";
import { CollectionOperations, DispatchDesk, SamplesDirectory } from "@/components/samples/sample-workbench";
import { FinanceWorkbench } from "@/components/finance/finance-workbench";
import { LeadFollowups, LeadsDirectory } from "@/components/leads/lead-workbench";
import { ReportWorkbench } from "@/components/reports/report-workbench";
import { RosterWorkbench } from "@/components/roster/roster-workbench";
import { OrderDirectory } from "@/components/orders/order-workbench";
import { getActionCentreAccess } from "@/server/action-centre-policy";
import { getTaskRelationshipReferenceTypes } from "@/lib/task-reference-permissions";

export default function ActionCentrePage() {
  return <AdminShell permission="workspace.read" title="Rudra Action Centre">{(staff) => {
    const access = getActionCentreAccess(staff.grants);
    return <>
      <section className="admin-card">
        <p className="eyebrow">O006 · Staff work queue</p>
        <h2>Operational actions in your authorized scope</h2>
        <p>Tasks and escalations remain separate records with their own permissions, histories and source workflows. Opening this combined workbench does not grant access to either source.</p>
      </section>
      {!access.tasks && !access.escalations && !access.operationalQueues && <section className="admin-card"><h2>No permitted action queues</h2><p>Your current session has no task, escalation or operational queue permission.</p></section>}
      {access.tasks && <section className="workspace-operations" aria-labelledby="action-centre-tasks"><h2 id="action-centre-tasks">Tasks and follow-ups</h2><TaskWorkbench staffId={staff.staffUserId} permissionGrants={staff.grants} canCreate={access.taskCreate} canUpdate={access.taskUpdate} canApprove={access.taskApprove} canAssign={access.taskAssign} canEscalate={staff.grants.some((grant) => grant.key === "escalations.create")} canFilterCentre={access.taskManagement} relationshipReferenceTypes={getTaskRelationshipReferenceTypes(staff.grants)} /></section>}
      {access.escalations && <section className="workspace-operations" aria-labelledby="action-centre-escalations"><h2 id="action-centre-escalations">Operational escalations</h2><EscalationWorkbench staffId={staff.staffUserId} grants={staff.grants} canCreate={access.escalationCreate} canRead={access.escalations} canAssign={access.escalationManage} /></section>}
      {access.appointments && <>
        {staff.grants.some((grant) => grant.key === "appointments.read") && <section className="workspace-operations"><h2>Appointment confirmations</h2><AppointmentList statusFilter="REQUESTED" canCreateBooking={staff.grants.some((grant) => grant.key === "appointments.create")} /></section>}
        {staff.grants.some((grant) => grant.key === "appointments.read") && <section className="workspace-operations"><h2>Today’s arrivals</h2><AppointmentList awaitingArrival canCreateBooking={staff.grants.some((grant) => grant.key === "appointments.create")} /></section>}
        {access.assignedAppointmentsOnly && <section className="workspace-operations"><h2>My assigned appointments</h2><p>This list is restricted by the appointment search API to assignments for your staff account.</p><AppointmentList /></section>}
      </>}
      {access.orders && <section className="workspace-operations"><h2>Diagnostic order coordination</h2><OrderDirectory showSummary={false} canCreate={false} initialStatus="PENDING_VERIFICATION" /></section>}
      {access.collections && <section className="workspace-operations"><h2>Collection workload</h2><CollectionOperations grants={staff.grants} /></section>}
      {access.sampleRead && <section className="workspace-operations"><h2>Sample exceptions</h2><SamplesDirectory mode="exceptions" grants={staff.grants} /></section>}
      {access.sampleReceive && <section className="workspace-operations"><h2>Rudra receiving</h2><SamplesDirectory mode="receiving" grants={staff.grants} /></section>}
      {access.sampleDispatch && <section className="workspace-operations"><h2>Sample dispatch</h2><DispatchDesk grants={staff.grants} /></section>}
      {access.finance && <section className="workspace-operations"><h2>Financial exceptions and balances</h2><FinanceWorkbench mode="dashboard" grants={staff.grants} /></section>}
      {access.leads && <section className="workspace-operations"><h2>Assigned CRM pipeline</h2><LeadsDirectory assignedStaffId={staff.staffUserId} /></section>}
      {access.reports && <section className="workspace-operations"><h2>Reports dashboard</h2><ReportWorkbench mode="dashboard" grants={staff.grants} staffId={staff.staffUserId} /></section>}
      {access.reportFollowups && <section className="workspace-operations"><h2>Report follow-ups</h2><ReportWorkbench mode="followups" grants={staff.grants} staffId={staff.staffUserId} /></section>}
      {access.leadFollowups && <section className="workspace-operations"><h2>Assigned CRM follow-ups</h2><LeadFollowups assignedStaffId={staff.staffUserId} /></section>}
      {access.roster && <section className="workspace-operations"><h2>Roster and assignment conflicts</h2><RosterWorkbench sessionStaffId={staff.staffUserId} grants={staff.grants} /></section>}
    </>;
  }}</AdminShell>;
}
