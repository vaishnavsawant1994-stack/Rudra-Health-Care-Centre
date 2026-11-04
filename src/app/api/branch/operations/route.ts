import { and, asc, count, eq, gte, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appointmentArrivalEvents, appointments, centres, collectionJobs, diagnosticOrders, leadFollowups, publicEnquiries, sampleExceptions, specimens, staffEscalations, staffShifts, staffTasks } from "@/db/schema";
import { localDateTimeToUtc } from "@/server/appointment-policy";
import { canViewOperationsMetric, canViewTaskApprovalExpiryQueue, canViewTeamRosterMetrics, collectionQueueTitle, collectionSummaryIsAssignedOnly, openCollectionJobStatuses, sampleExceptionSummaryScope, visibleOperationsCentres } from "@/server/centre-operations-policy";
import { buildOperationsQueuePreview } from "@/server/centre-operations-queue";
import { escalationDeepLinkHref } from "@/lib/escalation-deep-link";
import { escalationSourceHref } from "@/lib/escalation-source-link";
import { centreTaskHref } from "@/lib/centre-task-link";
import { centreFollowupHref } from "@/server/centre-followup-link";

export async function GET() {
  const access = await getApiAccess("workspace.read");
  if (access.response) return access.response;
  const { staff } = access;
  const scope = visibleOperationsCentres(staff.grants);
  if (scope?.length === 0) return Response.json({ centres: [] });

  const centreRows = await getDb().select({ id: centres.id, code: centres.code, name: centres.name, timeZone: centres.timeZone })
    .from(centres).where(and(eq(centres.organizationId, staff.organizationId), eq(centres.status, "ACTIVE"), scope ? inArray(centres.id, scope) : undefined)).orderBy(asc(centres.name));

  const now = new Date();
  const next24Hours = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const summaries = await Promise.all(centreRows.map(async (centre) => {
    const queue: Array<{ id: string; kind: string; title: string; reference: string; status: string; at: string; href: string }> = [];
    const metrics: { appointmentsNext24Hours?: number; appointmentsWithoutArrivalToday?: number; pendingConfirmations?: number; pendingWebsiteEnquiries?: number; openOrders?: number; activeCollections?: number; pendingReceiving?: number; pendingDispatch?: number; openExceptions?: number; overdueLeadFollowups?: number; overdueReportFollowups?: number; openTasks?: number; openSupportRequests?: number; pendingTaskApprovals?: number; taskApprovalExpiryDue?: number; taskApprovalEscalationDue?: number; overdueTasks?: number; scheduledStaff?: number; staffUnavailable?: number; openEscalations?: number; overdueEscalations?: number; financePendingPayments?: number; financeDisputes?: number; financeRefundRequests?: number } = {};
    if (canViewOperationsMetric(staff.grants, "appointments.read", centre.id) || canViewOperationsMetric(staff.grants, "appointments.assigned.read", centre.id)) {
      const assignedOnly = !canViewOperationsMetric(staff.grants, "appointments.read", centre.id);
      const conditions = [eq(appointments.organizationId, staff.organizationId), eq(appointments.centreId, centre.id), gte(appointments.scheduledAt, now), lt(appointments.scheduledAt, next24Hours), notInArray(appointments.status, ["CANCELLED", "NO_SHOW"])];
      if (assignedOnly) conditions.push(eq(appointments.assignedStaffId, staff.staffUserId));
      const [row] = await getDb().select({ value: count() }).from(appointments).where(and(...conditions));
      metrics.appointmentsNext24Hours = row?.value ?? 0;
      const parts = new Intl.DateTimeFormat("en-GB", { timeZone: centre.timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
      const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
      const localDate = `${part("year")}-${part("month")}-${part("day")}`;
      const nextDate = new Date(`${localDate}T00:00:00.000Z`); nextDate.setUTCDate(nextDate.getUTCDate() + 1);
      const startOfDay = localDateTimeToUtc(`${localDate}T00:00`, centre.timeZone);
      const startOfNextDay = localDateTimeToUtc(`${nextDate.toISOString().slice(0, 10)}T00:00`, centre.timeZone);
      if (startOfDay && startOfNextDay) {
        const arrivalConditions = [eq(appointments.organizationId, staff.organizationId), eq(appointments.centreId, centre.id), eq(appointments.visitType, "CENTRE"), gte(appointments.scheduledAt, startOfDay), lt(appointments.scheduledAt, startOfNextDay), inArray(appointments.status, ["CONFIRMED", "ASSIGNED", "RESCHEDULED"]), isNull(appointmentArrivalEvents.id)];
        if (assignedOnly) arrivalConditions.push(eq(appointments.assignedStaffId, staff.staffUserId));
        const [arrivals] = await getDb().select({ value: count() }).from(appointments).leftJoin(appointmentArrivalEvents, and(eq(appointmentArrivalEvents.appointmentId, appointments.id), eq(appointmentArrivalEvents.organizationId, appointments.organizationId), eq(appointmentArrivalEvents.centreId, appointments.centreId))).where(and(...arrivalConditions));
        metrics.appointmentsWithoutArrivalToday = arrivals?.value ?? 0;
        const arrivalRows = await getDb().select({ id: appointments.id, number: appointments.appointmentNumber, status: appointments.status, scheduledAt: appointments.scheduledAt }).from(appointments).leftJoin(appointmentArrivalEvents, and(eq(appointmentArrivalEvents.appointmentId, appointments.id), eq(appointmentArrivalEvents.organizationId, appointments.organizationId), eq(appointmentArrivalEvents.centreId, appointments.centreId))).where(and(...arrivalConditions)).orderBy(asc(appointments.scheduledAt), asc(appointments.id)).limit(10);
        for (const row of arrivalRows) queue.push({ id: row.id, kind: "APPOINTMENT_ARRIVAL", title: "Centre visit awaiting arrival check-in", reference: row.number, status: row.status, at: row.scheduledAt.toISOString(), href: "/appointments/arrivals" });
      }
      const pendingConditions = [eq(appointments.organizationId, staff.organizationId), eq(appointments.centreId, centre.id), eq(appointments.status, "REQUESTED")];
      if (assignedOnly) pendingConditions.push(eq(appointments.assignedStaffId, staff.staffUserId));
      const [pending] = await getDb().select({ value: count() }).from(appointments).where(and(...pendingConditions));
      metrics.pendingConfirmations = pending?.value ?? 0;
      const pendingRows = await getDb().select({ id: appointments.id, number: appointments.appointmentNumber, status: appointments.status, scheduledAt: appointments.scheduledAt }).from(appointments).where(and(...pendingConditions)).orderBy(asc(appointments.scheduledAt), asc(appointments.id)).limit(10);
      for (const row of pendingRows) queue.push({ id: row.id, kind: "APPOINTMENT", title: "Booking confirmation", reference: row.number, status: row.status, at: row.scheduledAt.toISOString(), href: `/appointments/${row.id}` });
    }
    if (canViewOperationsMetric(staff.grants, "leads.read", centre.id)) {
      const pendingConditions = [eq(publicEnquiries.organizationId, staff.organizationId), eq(publicEnquiries.centreId, centre.id), eq(publicEnquiries.status, "PENDING_REVIEW")];
      const [pending] = await getDb().select({ value: count() }).from(publicEnquiries).where(and(...pendingConditions));
      metrics.pendingWebsiteEnquiries = pending?.value ?? 0;
      const rows = await getDb().select({ id: publicEnquiries.id, reference: publicEnquiries.enquiryNumber, status: publicEnquiries.status, createdAt: publicEnquiries.createdAt }).from(publicEnquiries).where(and(...pendingConditions)).orderBy(asc(publicEnquiries.createdAt), asc(publicEnquiries.id)).limit(10);
      for (const item of rows) queue.push({ id: item.id, kind: "WEBSITE_ENQUIRY", title: "Website enquiry pending review", reference: item.reference, status: item.status, at: item.createdAt.toISOString(), href: escalationSourceHref("PUBLIC_ENQUIRY", item.id, centre.id)! });
    }
    if (canViewOperationsMetric(staff.grants, "orders.read", centre.id)) {
      const [row] = await getDb().select({ value: count() }).from(diagnosticOrders).where(and(eq(diagnosticOrders.organizationId, staff.organizationId), eq(diagnosticOrders.centreId, centre.id), inArray(diagnosticOrders.status, ["DRAFT", "PENDING_VERIFICATION"])));
      metrics.openOrders = row?.value ?? 0;
      const orders = await getDb().select({ id: diagnosticOrders.id, number: diagnosticOrders.orderNumber, status: diagnosticOrders.status, createdAt: diagnosticOrders.createdAt }).from(diagnosticOrders).where(and(eq(diagnosticOrders.organizationId, staff.organizationId), eq(diagnosticOrders.centreId, centre.id), inArray(diagnosticOrders.status, ["DRAFT", "PENDING_VERIFICATION"]))).orderBy(asc(diagnosticOrders.createdAt), asc(diagnosticOrders.id)).limit(10);
      for (const item of orders) queue.push({ id: item.id, kind: "ORDER", title: "Diagnostic order awaiting review", reference: item.number, status: item.status, at: item.createdAt.toISOString(), href: `/orders/${item.id}` });
    }
    if (canViewOperationsMetric(staff.grants, "finance.read", centre.id)) {
      const summaryResult = await getDb().execute(sql`SELECT
        (SELECT count(*)::int FROM finance_payments WHERE organization_id=${staff.organizationId} AND centre_id=${centre.id} AND status='RECORDED') AS "pendingPayments",
        (SELECT count(*)::int FROM finance_payments WHERE organization_id=${staff.organizationId} AND centre_id=${centre.id} AND status='DISPUTED') AS "disputedPayments",
        (SELECT count(*)::int FROM finance_refunds WHERE organization_id=${staff.organizationId} AND centre_id=${centre.id} AND status='REQUESTED') AS "refundRequests"`);
      const summary = (summaryResult as unknown as { rows: Array<{ pendingPayments: number; disputedPayments: number; refundRequests: number }> }).rows[0];
      metrics.financePendingPayments = Number(summary?.pendingPayments ?? 0);
      metrics.financeDisputes = Number(summary?.disputedPayments ?? 0);
      metrics.financeRefundRequests = Number(summary?.refundRequests ?? 0);
      const paymentResult = await getDb().execute(sql`SELECT id,payment_number AS "paymentNumber",status,recorded_at AS "recordedAt" FROM finance_payments WHERE organization_id=${staff.organizationId} AND centre_id=${centre.id} AND status IN ('RECORDED','DISPUTED') ORDER BY recorded_at,id LIMIT 10`);
      const payments = (paymentResult as unknown as { rows: Array<{ id: string; paymentNumber: string; status: string; recordedAt: Date | string }> }).rows;
      for (const item of payments) queue.push({ id: item.id, kind: item.status === "DISPUTED" ? "FINANCE_DISPUTE" : "FINANCE_PAYMENT", title: item.status === "DISPUTED" ? "Disputed payment review" : "Payment awaiting review", reference: item.paymentNumber, status: item.status, at: new Date(item.recordedAt).toISOString(), href: item.status === "DISPUTED" ? "/finance/exceptions" : `/finance/payments/${item.id}` });
      const refundResult = await getDb().execute(sql`SELECT id,payment_id AS "paymentId",status,created_at AS "createdAt" FROM finance_refunds WHERE organization_id=${staff.organizationId} AND centre_id=${centre.id} AND status='REQUESTED' ORDER BY created_at,id LIMIT 10`);
      const refunds = (refundResult as unknown as { rows: Array<{ id: string; paymentId: string; status: string; createdAt: Date | string }> }).rows;
      for (const item of refunds) queue.push({ id: item.id, kind: "FINANCE_REFUND", title: "Refund request awaiting review", reference: `Payment ${item.paymentId.slice(0, 8).toUpperCase()}`, status: item.status, at: new Date(item.createdAt).toISOString(), href: "/finance/refunds" });
    }
    if (canViewOperationsMetric(staff.grants, "collections.read", centre.id) || canViewOperationsMetric(staff.grants, "collections.assign", centre.id) || canViewOperationsMetric(staff.grants, "collections.visit.record", centre.id)) {
      const conditions = [eq(collectionJobs.organizationId, staff.organizationId), eq(collectionJobs.centreId, centre.id), inArray(collectionJobs.status, openCollectionJobStatuses)];
      if (collectionSummaryIsAssignedOnly(staff.grants, centre.id)) conditions.push(eq(collectionJobs.assignedStaffId, staff.staffUserId));
      const [row] = await getDb().select({ value: count() }).from(collectionJobs).where(and(...conditions));
      metrics.activeCollections = row?.value ?? 0;
      const workRows = await getDb().select({ id: collectionJobs.id, number: collectionJobs.jobNumber, status: collectionJobs.status, scheduledStart: collectionJobs.scheduledStart }).from(collectionJobs).where(and(...conditions)).orderBy(asc(collectionJobs.scheduledStart), asc(collectionJobs.id)).limit(10);
      for (const item of workRows) queue.push({ id: item.id, kind: "COLLECTION", title: collectionQueueTitle(item.status), reference: item.number, status: item.status, at: item.scheduledStart.toISOString(), href: `/collections/${item.id}` });
    }
    if (canViewOperationsMetric(staff.grants, "samples.receive", centre.id)) {
      const [row] = await getDb().select({ value: count() }).from(specimens).where(and(eq(specimens.organizationId, staff.organizationId), eq(specimens.centreId, centre.id), eq(specimens.status, "COLLECTED")));
      metrics.pendingReceiving = row?.value ?? 0;
      const waiting = await getDb().select({ id: specimens.id, number: specimens.specimenNumber, status: specimens.status, collectedAt: specimens.collectedAt }).from(specimens).where(and(eq(specimens.organizationId, staff.organizationId), eq(specimens.centreId, centre.id), eq(specimens.status, "COLLECTED"))).orderBy(asc(specimens.collectedAt), asc(specimens.id)).limit(10);
      for (const item of waiting) queue.push({ id: item.id, kind: "SAMPLE_RECEIVING", title: "Sample awaiting Rudra receiving", reference: item.number, status: item.status, at: item.collectedAt.toISOString(), href: "/branch/receiving" });
    }
    if (canViewOperationsMetric(staff.grants, "samples.dispatch", centre.id)) {
      const [row] = await getDb().select({ value: count() }).from(specimens).where(and(eq(specimens.organizationId, staff.organizationId), eq(specimens.centreId, centre.id), eq(specimens.status, "RECEIVED_AT_RUDRA")));
      metrics.pendingDispatch = row?.value ?? 0;
      const waiting = await getDb().select({ id: specimens.id, number: specimens.specimenNumber, status: specimens.status, receivedAt: specimens.receivedAt }).from(specimens).where(and(eq(specimens.organizationId, staff.organizationId), eq(specimens.centreId, centre.id), eq(specimens.status, "RECEIVED_AT_RUDRA"))).orderBy(asc(specimens.receivedAt), asc(specimens.id)).limit(10);
      for (const item of waiting) queue.push({ id: item.id, kind: "SAMPLE_DISPATCH", title: "Sample awaiting dispatch", reference: item.number, status: item.status, at: (item.receivedAt ?? now).toISOString(), href: "/branch/dispatch" });
    }
    const exceptionScope = sampleExceptionSummaryScope(staff.grants, centre.id);
    if (exceptionScope !== "none") {
      const exceptionConditions = [eq(sampleExceptions.organizationId, staff.organizationId), eq(sampleExceptions.centreId, centre.id), eq(sampleExceptions.status, "OPEN")];
      if (exceptionScope === "assigned") exceptionConditions.push(eq(collectionJobs.assignedStaffId, staff.staffUserId));
      const [row] = await getDb().select({ value: count() }).from(sampleExceptions)
        .innerJoin(specimens, and(eq(specimens.id, sampleExceptions.specimenId), eq(specimens.organizationId, sampleExceptions.organizationId), eq(specimens.centreId, sampleExceptions.centreId)))
        .innerJoin(collectionJobs, and(eq(collectionJobs.id, specimens.jobId), eq(collectionJobs.organizationId, specimens.organizationId), eq(collectionJobs.centreId, specimens.centreId)))
        .where(and(...exceptionConditions));
      metrics.openExceptions = row?.value ?? 0;
      const exceptions = await getDb().select({ id: sampleExceptions.id, kind: sampleExceptions.exceptionType, status: sampleExceptions.status, createdAt: sampleExceptions.createdAt }).from(sampleExceptions)
        .innerJoin(specimens, and(eq(specimens.id, sampleExceptions.specimenId), eq(specimens.organizationId, sampleExceptions.organizationId), eq(specimens.centreId, sampleExceptions.centreId)))
        .innerJoin(collectionJobs, and(eq(collectionJobs.id, specimens.jobId), eq(collectionJobs.organizationId, specimens.organizationId), eq(collectionJobs.centreId, specimens.centreId)))
        .where(and(...exceptionConditions)).orderBy(asc(sampleExceptions.createdAt), asc(sampleExceptions.id)).limit(10);
      for (const item of exceptions) queue.push({ id: item.id, kind: "SAMPLE_EXCEPTION", title: `Sample exception · ${item.kind.toLowerCase().replaceAll("_", " ")}`, reference: item.id.slice(0, 8).toUpperCase(), status: item.status, at: item.createdAt.toISOString(), href: escalationSourceHref("SAMPLE_EXCEPTION", item.id, centre.id)! });
    }
    if (canViewOperationsMetric(staff.grants, "leads.followups.manage", centre.id)) {
      const [row] = await getDb().select({ value: count() }).from(leadFollowups).where(and(eq(leadFollowups.organizationId, staff.organizationId), eq(leadFollowups.centreId, centre.id), eq(leadFollowups.status, "SCHEDULED"), lt(leadFollowups.dueAt, now)));
      metrics.overdueLeadFollowups = row?.value ?? 0;
      const followups = await getDb().select({ id: leadFollowups.id, leadId: leadFollowups.leadId, dueAt: leadFollowups.dueAt }).from(leadFollowups).where(and(eq(leadFollowups.organizationId, staff.organizationId), eq(leadFollowups.centreId, centre.id), eq(leadFollowups.status, "SCHEDULED"), lt(leadFollowups.dueAt, now))).orderBy(asc(leadFollowups.dueAt), asc(leadFollowups.id)).limit(10);
      for (const item of followups) queue.push({ id: item.id, kind: "LEAD_FOLLOWUP", title: "Overdue lead follow-up", reference: `Lead ${item.leadId.slice(0, 8).toUpperCase()}`, status: "SCHEDULED", at: item.dueAt.toISOString(), href: centreFollowupHref("LEAD_FOLLOWUP", item.id, centre.id) });
    }
    if (canViewOperationsMetric(staff.grants, "reports.followups.manage", centre.id)) {
      const result = await getDb().execute(sql`SELECT count(*)::int AS value FROM report_followups WHERE organization_id=${staff.organizationId} AND centre_id=${centre.id} AND status='SCHEDULED' AND due_at < ${now}`);
      metrics.overdueReportFollowups = Number((result as unknown as { rows: Array<{ value: number }> }).rows[0]?.value ?? 0);
      const resultRows = await getDb().execute(sql`SELECT f.id, r.report_number AS "reportNumber", f.task_type AS "taskType", f.due_at AS "dueAt" FROM report_followups f JOIN diagnostic_reports r ON r.id=f.report_id AND r.organization_id=f.organization_id AND r.centre_id=f.centre_id WHERE f.organization_id=${staff.organizationId} AND f.centre_id=${centre.id} AND f.status='SCHEDULED' AND f.due_at < ${now} ORDER BY f.due_at, f.id LIMIT 10`);
      const followups = (resultRows as unknown as { rows: Array<{ id: string; reportNumber: string; taskType: string; dueAt: Date | string }> }).rows;
      for (const item of followups) queue.push({ id: item.id, kind: "REPORT_FOLLOWUP", title: `Report follow-up · ${item.taskType.toLowerCase().replaceAll("_", " ")}`, reference: item.reportNumber, status: "SCHEDULED", at: new Date(item.dueAt).toISOString(), href: centreFollowupHref("REPORT_FOLLOWUP", item.id, centre.id) });
    }
    if (canViewOperationsMetric(staff.grants, "tasks.read", centre.id) || canViewOperationsMetric(staff.grants, "tasks.assigned.read", centre.id)) {
      const assignedOnly = !canViewOperationsMetric(staff.grants, "tasks.read", centre.id);
      const taskScope = [eq(staffTasks.organizationId, staff.organizationId), eq(staffTasks.centreId, centre.id), inArray(staffTasks.status, ["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL"])];
      if (assignedOnly) taskScope.push(eq(staffTasks.assignedStaffId, staff.staffUserId));
      const [open] = await getDb().select({ value: count() }).from(staffTasks).where(and(...taskScope));
      const approvalScope = [eq(staffTasks.organizationId, staff.organizationId), eq(staffTasks.centreId, centre.id), eq(staffTasks.status, "AWAITING_APPROVAL")];
      if (assignedOnly) approvalScope.push(eq(staffTasks.assignedStaffId, staff.staffUserId));
      const [approvals] = await getDb().select({ value: count() }).from(staffTasks).where(and(...approvalScope));
      const overdueScope = [eq(staffTasks.organizationId, staff.organizationId), eq(staffTasks.centreId, centre.id), inArray(staffTasks.status, ["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL"]), lt(staffTasks.dueAt, now)];
      if (assignedOnly) overdueScope.push(eq(staffTasks.assignedStaffId, staff.staffUserId));
      const [overdue] = await getDb().select({ value: count() }).from(staffTasks).where(and(...overdueScope));
      metrics.openTasks = open?.value ?? 0; metrics.pendingTaskApprovals = approvals?.value ?? 0; metrics.overdueTasks = overdue?.value ?? 0;
      const taskRows = await getDb().select({ id: staffTasks.id, number: staffTasks.taskNumber, status: staffTasks.status, dueAt: staffTasks.dueAt }).from(staffTasks).where(and(...taskScope)).orderBy(asc(staffTasks.dueAt), asc(staffTasks.id)).limit(10);
      for (const item of taskRows) queue.push({ id: item.id, kind: "TASK", title: "Staff task", reference: item.number, status: item.status, at: (item.dueAt ?? now).toISOString(), href: centreTaskHref(item.id, centre.id) });
    }
    if (canViewOperationsMetric(staff.grants, "tasks.support.read", centre.id)) {
      const supportScope = [eq(staffTasks.organizationId, staff.organizationId), eq(staffTasks.centreId, centre.id), eq(staffTasks.taskType, "SUPPORT_REQUEST"), inArray(staffTasks.status, ["OPEN", "IN_PROGRESS", "AWAITING_APPROVAL"])];
      const [open] = await getDb().select({ value: count() }).from(staffTasks).where(and(...supportScope));
      metrics.openSupportRequests = open?.value ?? 0;
      const supportRows = await getDb().select({ id: staffTasks.id, number: staffTasks.taskNumber, status: staffTasks.status, dueAt: staffTasks.dueAt, createdAt: staffTasks.createdAt }).from(staffTasks).where(and(...supportScope)).orderBy(asc(staffTasks.dueAt), asc(staffTasks.createdAt), asc(staffTasks.id)).limit(10);
      for (const item of supportRows) queue.push({ id: item.id, kind: "SUPPORT_REQUEST", title: "Open support request", reference: item.number, status: item.status, at: (item.dueAt ?? item.createdAt).toISOString(), href: `/support/tickets/${encodeURIComponent(item.id)}` });
    }
    if (canViewTaskApprovalExpiryQueue(staff.grants, centre.id)) {
      const expiryScope = and(eq(staffTasks.organizationId, staff.organizationId), eq(staffTasks.centreId, centre.id), eq(staffTasks.status, "AWAITING_APPROVAL"), eq(staffTasks.approvalStatus, "PENDING"), lt(staffTasks.approvalExpiresAt, now));
      const [expiryDue] = await getDb().select({ value: count() }).from(staffTasks).where(expiryScope);
      metrics.taskApprovalExpiryDue = expiryDue?.value ?? 0;
      const dueTasks = await getDb().select({ id: staffTasks.id, number: staffTasks.taskNumber, expiresAt: staffTasks.approvalExpiresAt }).from(staffTasks).where(expiryScope).orderBy(asc(staffTasks.approvalExpiresAt), asc(staffTasks.id)).limit(10);
      for (const task of dueTasks) if (task.expiresAt) queue.push({ id: task.id, kind: "TASK_APPROVAL_EXPIRY", title: "Task approval deadline elapsed", reference: task.number, status: "PENDING", at: task.expiresAt.toISOString(), href: centreTaskHref(task.id, centre.id, "expiry-due") });
      const escalationScope = and(eq(staffTasks.organizationId, staff.organizationId), eq(staffTasks.centreId, centre.id), eq(staffTasks.status, "AWAITING_APPROVAL"), eq(staffTasks.approvalStatus, "PENDING"), isNull(staffTasks.escalationProcessedAt), lt(staffTasks.escalationDueAt, now));
      const [escalationDue] = await getDb().select({ value: count() }).from(staffTasks).where(escalationScope);
      metrics.taskApprovalEscalationDue = escalationDue?.value ?? 0;
      const escalationTasks = await getDb().select({ id: staffTasks.id, number: staffTasks.taskNumber, dueAt: staffTasks.escalationDueAt }).from(staffTasks).where(escalationScope).orderBy(asc(staffTasks.escalationDueAt), asc(staffTasks.id)).limit(10);
      for (const task of escalationTasks) if (task.dueAt) queue.push({ id: task.id, kind: "TASK_APPROVAL_ESCALATION", title: "Task approval escalation due", reference: task.number, status: "PENDING", at: task.dueAt.toISOString(), href: centreTaskHref(task.id, centre.id, "escalation-due") });
    }
    if (canViewTeamRosterMetrics(staff.grants, centre.id)) {
      const windowScope = [eq(staffShifts.organizationId, staff.organizationId), eq(staffShifts.centreId, centre.id), eq(staffShifts.status, "ACTIVE"), gte(staffShifts.endsAt, now), lt(staffShifts.startsAt, next24Hours)];
      const [scheduled] = await getDb().select({ value: count() }).from(staffShifts).where(and(...windowScope, eq(staffShifts.shiftType, "SCHEDULED")));
      const [unavailable] = await getDb().select({ value: count() }).from(staffShifts).where(and(...windowScope, eq(staffShifts.shiftType, "UNAVAILABLE")));
      metrics.scheduledStaff = scheduled?.value ?? 0; metrics.staffUnavailable = unavailable?.value ?? 0;
    }
    if (canViewOperationsMetric(staff.grants, "escalations.read", centre.id) || canViewOperationsMetric(staff.grants, "escalations.assigned.read", centre.id)) {
      const broad = canViewOperationsMetric(staff.grants, "escalations.read", centre.id);
      const scope = [eq(staffEscalations.organizationId, staff.organizationId), eq(staffEscalations.centreId, centre.id), inArray(staffEscalations.status, ["OPEN", "ACKNOWLEDGED"])];
      if (!broad) scope.push(eq(staffEscalations.assignedOwnerStaffId, staff.staffUserId));
      const [open, overdue] = await Promise.all([
        getDb().select({ value: count() }).from(staffEscalations).where(and(...scope)),
        getDb().select({ value: count() }).from(staffEscalations).where(and(...scope, lt(staffEscalations.dueAt, now))),
      ]);
      metrics.openEscalations = open[0]?.value ?? 0;
      metrics.overdueEscalations = overdue[0]?.value ?? 0;
      const escalationRows = await getDb().select({ id: staffEscalations.id, number: staffEscalations.escalationNumber, status: staffEscalations.status, dueAt: staffEscalations.dueAt }).from(staffEscalations).where(and(...scope)).orderBy(asc(staffEscalations.dueAt), asc(staffEscalations.id)).limit(10);
      for (const item of escalationRows) queue.push({ id: item.id, kind: "ESCALATION", title: "Operational escalation", reference: item.number, status: item.status, at: item.dueAt.toISOString(), href: escalationDeepLinkHref(item.id, centre.id) });
    }
    const queuePreview = buildOperationsQueuePreview(queue, metrics);
    return { id: centre.id, code: centre.code, name: centre.name, timeZone: centre.timeZone, metrics, queue: queuePreview.items, omittedByKind: queuePreview.omittedByKind };
  }));

  return Response.json({ range: { from: now.toISOString(), to: next24Hours.toISOString() }, centres: summaries }, { headers: { "cache-control": "private, no-store" } });
}
