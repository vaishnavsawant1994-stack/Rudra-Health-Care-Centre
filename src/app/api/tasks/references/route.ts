import { and, asc, eq, or, sql } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appointments, collectionJobs, leadFollowups, leads, publicEnquiries, sampleExceptions, specimens, staffEscalations, staffTasks } from "@/db/schema";
import { assignmentVisibility, assignmentVisibilityAtCentre } from "@/server/assignment-visibility";
import { z } from "zod";

const REFERENCE_PAGE_SIZE = 100;
const querySchema = z.object({ centreId: z.uuid(), type: z.enum(["APPOINTMENT", "LEAD", "LEAD_FOLLOWUP", "PUBLIC_ENQUIRY", "COLLECTION_JOB", "SAMPLE_EXCEPTION", "REPORT", "REPORT_FOLLOWUP", "FINANCE_PAYMENT", "FINANCE_REFUND", "STAFF_TASK", "STAFF_ESCALATION", "CORPORATE_RELATIONSHIP", "PARTNER_RELATIONSHIP", "DOCTOR_RELATIONSHIP"]), page: z.coerce.number().int().min(1).max(100000).default(1), pageSize: z.coerce.number().int().min(1).max(REFERENCE_PAGE_SIZE).default(REFERENCE_PAGE_SIZE) });

function paged<T>(rows: T[], page: number, pageSize: number, make: (row: T) => { id: string; label: string }) {
  return Response.json({ references: rows.slice(0, pageSize).map(make), page, pageSize, hasMore: rows.length > pageSize });
}

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_reference_query" }, { status: 400 });
  const { centreId, type, page, pageSize } = parsed.data;
  const offset = (page - 1) * pageSize;
  const permissions = {
    APPOINTMENT: ["appointments.read", "appointments.assigned.read"] as const,
    LEAD: ["leads.read"] as const,
    LEAD_FOLLOWUP: ["leads.followups.manage"] as const,
    PUBLIC_ENQUIRY: ["leads.read"] as const,
    COLLECTION_JOB: ["collections.read"] as const,
    SAMPLE_EXCEPTION: ["samples.read"] as const,
    REPORT: ["reports.read"] as const,
    REPORT_FOLLOWUP: ["reports.followups.manage"] as const,
    FINANCE_PAYMENT: ["finance.read"] as const,
    FINANCE_REFUND: ["finance.read"] as const,
    STAFF_TASK: ["tasks.read", "tasks.assigned.read", "tasks.support.read"] as const,
    STAFF_ESCALATION: ["escalations.read", "escalations.assigned.read"] as const,
    CORPORATE_RELATIONSHIP: ["corporate.read"] as const,
    PARTNER_RELATIONSHIP: ["partners.read"] as const,
    DOCTOR_RELATIONSHIP: ["doctors.read"] as const,
  }[type];
  let access = await getApiAccess(permissions[0], centreId);
  let assignedOnly = false;
  if (access.response && type === "APPOINTMENT") {
    access = await getApiAccess("appointments.assigned.read", centreId);
    assignedOnly = !access.response;
  }
  let tasksBroad = false;
  let tasksAssigned = false;
  let tasksSupport = false;
  let escalationsAssigned = false;
  if (type === "STAFF_TASK") {
    tasksBroad = !access.response;
    if (!tasksBroad) {
      const assignedAccess = await getApiAccess("tasks.assigned.read", centreId);
      tasksAssigned = !assignedAccess.response;
      if (tasksAssigned) access = assignedAccess;
      const supportAccess = await getApiAccess("tasks.support.read", centreId);
      tasksSupport = !supportAccess.response;
      if (!tasksAssigned && tasksSupport) access = supportAccess;
    }
  }
  if (type === "STAFF_ESCALATION" && access.response) {
    access = await getApiAccess("escalations.assigned.read", centreId);
    escalationsAssigned = !access.response;
  }
  if (type === "COLLECTION_JOB" && access.response) {
    access = await getApiAccess("collections.visit.record", centreId);
    assignedOnly = !access.response;
  }
  if (access.response) return access.response;
  const { staff } = access;
  const db = getDb();
  if (type === "STAFF_TASK") {
    const scope = tasksBroad
      ? undefined
      : tasksAssigned && tasksSupport
        ? or(eq(staffTasks.assignedStaffId, staff.staffUserId), eq(staffTasks.taskType, "SUPPORT_REQUEST"), and(eq(staffTasks.escalationOwnerStaffId, staff.staffUserId), eq(staffTasks.status, "AWAITING_APPROVAL"), eq(staffTasks.approvalStatus, "PENDING"), sql`${staffTasks.escalationProcessedAt} IS NOT NULL`))
        : tasksAssigned
          ? or(eq(staffTasks.assignedStaffId, staff.staffUserId), and(eq(staffTasks.escalationOwnerStaffId, staff.staffUserId), eq(staffTasks.status, "AWAITING_APPROVAL"), eq(staffTasks.approvalStatus, "PENDING"), sql`${staffTasks.escalationProcessedAt} IS NOT NULL`))
          : tasksSupport ? eq(staffTasks.taskType, "SUPPORT_REQUEST") : undefined;
    const rows = await db.select({ id: staffTasks.id, number: staffTasks.taskNumber, status: staffTasks.status }).from(staffTasks).where(and(eq(staffTasks.organizationId, staff.organizationId), eq(staffTasks.centreId, centreId), scope)).orderBy(asc(staffTasks.dueAt), asc(staffTasks.taskNumber), asc(staffTasks.id)).limit(pageSize + 1).offset(offset);
    return paged(rows, page, pageSize, (row) => ({ id: row.id, label: `${row.number} · ${row.status}` }));
  }
  if (type === "STAFF_ESCALATION") {
    const rows = await db.select({ id: staffEscalations.id, number: staffEscalations.escalationNumber, status: staffEscalations.status, dueAt: staffEscalations.dueAt })
      .from(staffEscalations)
      .where(and(eq(staffEscalations.organizationId, staff.organizationId), eq(staffEscalations.centreId, centreId), escalationsAssigned ? eq(staffEscalations.assignedOwnerStaffId, staff.staffUserId) : undefined))
      .orderBy(asc(staffEscalations.dueAt), asc(staffEscalations.id)).limit(pageSize + 1).offset(offset);
    return paged(rows, page, pageSize, (row) => ({ id: row.id, label: `${row.number} · ${row.status} · ${row.dueAt.toLocaleString()}` }));
  }
  if (type === "APPOINTMENT") {
    const rows = await db.select({ id: appointments.id, number: appointments.appointmentNumber, status: appointments.status, scheduledAt: appointments.scheduledAt, assignedStaffId: appointments.assignedStaffId }).from(appointments).where(and(eq(appointments.organizationId, staff.organizationId), eq(appointments.centreId, centreId), assignedOnly ? eq(appointments.assignedStaffId, staff.staffUserId) : undefined)).orderBy(asc(appointments.scheduledAt), asc(appointments.id)).limit(pageSize + 1).offset(offset);
    return paged(rows, page, pageSize, (row) => ({ id: row.id, label: `${row.number} · ${row.status} · ${row.scheduledAt.toLocaleString()}` }));
  }
  if (type === "LEAD") {
    const rows = await db.select({ id: leads.id, number: leads.leadNumber, status: leads.status }).from(leads).where(and(eq(leads.organizationId, staff.organizationId), eq(leads.centreId, centreId))).orderBy(asc(leads.leadNumber), asc(leads.id)).limit(pageSize + 1).offset(offset);
    return paged(rows, page, pageSize, (row) => ({ id: row.id, label: `${row.number} · ${row.status}` }));
  }
  if (type === "LEAD_FOLLOWUP") {
    const rows = await db.select({ id: leadFollowups.id, leadNumber: leads.leadNumber, status: leadFollowups.status, dueAt: leadFollowups.dueAt })
      .from(leadFollowups)
      .innerJoin(leads, and(eq(leads.id, leadFollowups.leadId), eq(leads.organizationId, leadFollowups.organizationId), eq(leads.centreId, leadFollowups.centreId)))
      .where(and(eq(leadFollowups.organizationId, staff.organizationId), eq(leadFollowups.centreId, centreId)))
      .orderBy(asc(leadFollowups.dueAt), asc(leadFollowups.id)).limit(pageSize + 1).offset(offset);
    return paged(rows, page, pageSize, (row) => ({ id: row.id, label: `Lead follow-up · ${row.leadNumber} · ${row.status} · ${row.dueAt.toLocaleString()}` }));
  }
  if (type === "PUBLIC_ENQUIRY") {
    const rows = await db.select({ id: publicEnquiries.id, number: publicEnquiries.enquiryNumber, status: publicEnquiries.status }).from(publicEnquiries)
      .where(and(eq(publicEnquiries.organizationId, staff.organizationId), eq(publicEnquiries.centreId, centreId)))
      .orderBy(asc(publicEnquiries.createdAt), asc(publicEnquiries.id)).limit(pageSize + 1).offset(offset);
    return paged(rows, page, pageSize, (row) => ({ id: row.id, label: `Website enquiry ${row.number} · ${row.status}` }));
  }
  if (type === "CORPORATE_RELATIONSHIP" || type === "PARTNER_RELATIONSHIP") {
    const relationshipType = type === "CORPORATE_RELATIONSHIP" ? "CORPORATE" : "PARTNER";
    const result = await db.execute(sql`SELECT id, relationship_number AS "relationshipNumber", category, status FROM business_relationships WHERE organization_id=${staff.organizationId} AND centre_id=${centreId} AND relationship_type=${relationshipType} ORDER BY relationship_number, id LIMIT ${pageSize + 1} OFFSET ${offset}`);
    const rows = (result as unknown as { rows: Array<{ id: string; relationshipNumber: string; category: string; status: string }> }).rows;
    return paged(rows, page, pageSize, (row) => ({ id: row.id, label: `${relationshipType === "CORPORATE" ? "Corporate" : "Partner"} relationship ${row.relationshipNumber} · ${row.category} · ${row.status}` }));
  }
  if (type === "DOCTOR_RELATIONSHIP") {
    const result = await db.execute(sql`SELECT id, doctor_number AS "doctorNumber", specialty, status FROM doctor_profiles WHERE organization_id=${staff.organizationId} AND centre_id=${centreId} ORDER BY doctor_number, id LIMIT ${pageSize + 1} OFFSET ${offset}`);
    const rows = (result as unknown as { rows: Array<{ id: string; doctorNumber: string; specialty: string; status: string }> }).rows;
    return paged(rows, page, pageSize, (row) => ({ id: row.id, label: `Doctor relationship ${row.doctorNumber} · ${row.specialty} · ${row.status}` }));
  }
  if (type === "COLLECTION_JOB") {
    const mayReadAll = staff.grants.some((g) => g.key === "collections.read" && (g.centreId === null || g.centreId === centreId));
    const mayVisit = staff.grants.some((g) => g.key === "collections.visit.record" && (g.centreId === null || g.centreId === centreId));
    if (!mayReadAll && !mayVisit) return Response.json({ error: "forbidden" }, { status: 403 });
    const assignmentOnly = assignedOnly || (mayVisit && !staff.grants.some((g) => g.key === "collections.assign" && (g.centreId === null || g.centreId === centreId)));
    const rows = await db.select({ id: collectionJobs.id, number: collectionJobs.jobNumber, status: collectionJobs.status, scheduledStart: collectionJobs.scheduledStart, assignedStaffId: collectionJobs.assignedStaffId }).from(collectionJobs).where(and(eq(collectionJobs.organizationId, staff.organizationId), eq(collectionJobs.centreId, centreId), assignmentOnly ? eq(collectionJobs.assignedStaffId, staff.staffUserId) : undefined)).orderBy(asc(collectionJobs.scheduledStart), asc(collectionJobs.id)).limit(pageSize + 1).offset(offset);
    return paged(rows, page, pageSize, (row) => ({ id: row.id, label: `${row.number} · ${row.status} · ${row.scheduledStart.toLocaleString()}` }));
  }
  if (type === "SAMPLE_EXCEPTION") {
    const visibility = assignmentVisibility(staff.grants, "samples.read", "collections.assign", ["samples.collect", "collections.visit.record"]);
    const scope = assignmentVisibilityAtCentre(visibility, centreId);
    if (scope === "none") return Response.json({ error: "forbidden" }, { status: 403 });
    const rows = await db.select({ id: sampleExceptions.id, type: sampleExceptions.exceptionType, status: sampleExceptions.status }).from(sampleExceptions)
      .innerJoin(specimens, and(eq(specimens.id, sampleExceptions.specimenId), eq(specimens.organizationId, sampleExceptions.organizationId), eq(specimens.centreId, sampleExceptions.centreId)))
      .innerJoin(collectionJobs, and(eq(collectionJobs.id, specimens.jobId), eq(collectionJobs.organizationId, specimens.organizationId), eq(collectionJobs.centreId, specimens.centreId)))
      .where(and(eq(sampleExceptions.organizationId, staff.organizationId), eq(sampleExceptions.centreId, centreId), scope === "assigned" ? eq(collectionJobs.assignedStaffId, staff.staffUserId) : undefined))
      .orderBy(asc(sampleExceptions.createdAt), asc(sampleExceptions.id)).limit(pageSize + 1).offset(offset);
    return paged(rows, page, pageSize, (row) => ({ id: row.id, label: `Sample exception · ${row.type} · ${row.status}` }));
  }
  if (type === "REPORT") {
    const result = await db.execute(sql`SELECT id,report_number AS "reportNumber",status FROM diagnostic_reports WHERE organization_id=${staff.organizationId} AND centre_id=${centreId} ORDER BY created_at DESC, id LIMIT ${pageSize + 1} OFFSET ${offset}`);
    const rows = (result as unknown as { rows: Array<{ id: string; reportNumber: string; status: string }> }).rows;
    return paged(rows, page, pageSize, (row) => ({ id: row.id, label: `Report ${row.reportNumber} · ${row.status}` }));
  }
  if (type === "REPORT_FOLLOWUP") {
    const result = await db.execute(sql`SELECT id,task_type AS "taskType",status,due_at AS "dueAt" FROM report_followups WHERE organization_id=${staff.organizationId} AND centre_id=${centreId} ORDER BY due_at ASC, id LIMIT ${pageSize + 1} OFFSET ${offset}`);
    const rows = (result as unknown as { rows: Array<{ id: string; taskType: string; status: string; dueAt: Date }> }).rows;
    return paged(rows, page, pageSize, (row) => ({ id: row.id, label: `Report follow-up · ${row.taskType} · ${row.status} · ${row.dueAt.toLocaleString()}` }));
  }
  if (type === "FINANCE_PAYMENT") {
    const result = await db.execute(sql`SELECT id,status FROM finance_payments WHERE organization_id=${staff.organizationId} AND centre_id=${centreId} AND status='DISPUTED' ORDER BY recorded_at DESC, id LIMIT ${pageSize + 1} OFFSET ${offset}`);
    const rows = (result as unknown as { rows: Array<{ id: string; status: string }> }).rows;
    return paged(rows, page, pageSize, (row) => ({ id: row.id, label: `Disputed payment · ${row.status}` }));
  }
  const result = await db.execute(sql`SELECT id,status FROM finance_refunds WHERE organization_id=${staff.organizationId} AND centre_id=${centreId} AND status='REQUESTED' ORDER BY created_at ASC, id LIMIT ${pageSize + 1} OFFSET ${offset}`);
  const rows = (result as unknown as { rows: Array<{ id: string; status: string }> }).rows;
  return paged(rows, page, pageSize, (row) => ({ id: row.id, label: `Refund review · ${row.status}` }));
}
