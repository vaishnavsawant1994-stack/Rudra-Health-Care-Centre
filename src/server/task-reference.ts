import { and, eq, sql } from "drizzle-orm";
import type { StaffContext } from "@/server/access";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appointments, collectionJobs, leadFollowups, leads, publicEnquiries, sampleExceptions, specimens, staffEscalations, staffTasks } from "@/db/schema";
import { canReadTask } from "@/server/staff-task-policy";
import { assignmentVisibility, assignmentVisibilityAtCentre } from "@/server/assignment-visibility";

export type TaskReference = { type: "APPOINTMENT" | "LEAD" | "LEAD_FOLLOWUP" | "PUBLIC_ENQUIRY" | "COLLECTION_JOB" | "SAMPLE_EXCEPTION" | "REPORT" | "REPORT_FOLLOWUP" | "FINANCE_PAYMENT" | "FINANCE_REFUND" | "STAFF_TASK" | "STAFF_ESCALATION" | "CORPORATE_RELATIONSHIP" | "PARTNER_RELATIONSHIP" | "DOCTOR_RELATIONSHIP"; id: string };
type Rows<T> = { rows: T[] };

export async function resolveTaskReference(staff: Pick<StaffContext, "organizationId" | "staffUserId" | "grants">, centreId: string, reference: TaskReference, options: { forEscalationCreation?: boolean } = {}): Promise<string | null> {
  const db = getDb();
  if (reference.type === "STAFF_TASK") {
    let access = await getApiAccess("tasks.read", centreId);
    if (access.response) access = await getApiAccess("tasks.assigned.read", centreId);
    if (access.response) access = await getApiAccess("tasks.support.read", centreId);
    if (access.response) return null;
    const activeStaff = access.staff;
    const [row] = await db.select({ number: staffTasks.taskNumber, status: staffTasks.status, taskType: staffTasks.taskType, assignedStaffId: staffTasks.assignedStaffId, escalationOwnerStaffId: staffTasks.escalationOwnerStaffId, escalationProcessedAt: staffTasks.escalationProcessedAt, approvalStatus: staffTasks.approvalStatus }).from(staffTasks).where(and(eq(staffTasks.id, reference.id), eq(staffTasks.organizationId, staff.organizationId), eq(staffTasks.centreId, centreId))).limit(1);
    if (!row || !canReadTask(activeStaff.grants, centreId, row.assignedStaffId, activeStaff.staffUserId, { ownerStaffId: row.escalationOwnerStaffId, processedAt: row.escalationProcessedAt, pending: row.status === "AWAITING_APPROVAL" && row.approvalStatus === "PENDING" }, row.taskType)) return null;
    return `${row.number} · ${row.status}`;
  }
  if (reference.type === "STAFF_ESCALATION") {
    let access = await getApiAccess("escalations.read", centreId);
    let assignedOnly = false;
    if (access.response) {
      access = await getApiAccess("escalations.assigned.read", centreId);
      assignedOnly = !access.response;
    }
    if (access.response) return null;
    const [row] = await db.select({ number: staffEscalations.escalationNumber, status: staffEscalations.status, assignedOwnerStaffId: staffEscalations.assignedOwnerStaffId }).from(staffEscalations)
      .where(and(eq(staffEscalations.id, reference.id), eq(staffEscalations.organizationId, staff.organizationId), eq(staffEscalations.centreId, centreId), assignedOnly ? eq(staffEscalations.assignedOwnerStaffId, staff.staffUserId) : undefined)).limit(1);
    return row ? `${row.number} · ${row.status}` : null;
  }
  if (reference.type === "APPOINTMENT") {
    let access = await getApiAccess("appointments.read", centreId);
    if (access.response) access = await getApiAccess("appointments.assigned.read", centreId);
    if (access.response) return null;
    const [row] = await db.select({ number: appointments.appointmentNumber, status: appointments.status, assignedStaffId: appointments.assignedStaffId }).from(appointments).where(and(eq(appointments.id, reference.id), eq(appointments.organizationId, staff.organizationId), eq(appointments.centreId, centreId))).limit(1);
    const broad = staff.grants.some((g) => g.key === "appointments.read" && (g.centreId === null || g.centreId === centreId));
    if (!row || (!broad && row.assignedStaffId !== staff.staffUserId)) return null;
    return `${row.number} · ${row.status}`;
  }
  if (reference.type === "LEAD") {
    const access = await getApiAccess("leads.read", centreId);
    if (access.response) return null;
    const [row] = await db.select({ number: leads.leadNumber, status: leads.status }).from(leads).where(and(eq(leads.id, reference.id), eq(leads.organizationId, staff.organizationId), eq(leads.centreId, centreId))).limit(1);
    return row ? `${row.number} · ${row.status}` : null;
  }
  if (reference.type === "LEAD_FOLLOWUP") {
    const access = await getApiAccess("leads.followups.manage", centreId);
    if (access.response) return null;
    const [row] = await db.select({ leadNumber: leads.leadNumber, status: leadFollowups.status, dueAt: leadFollowups.dueAt })
      .from(leadFollowups)
      .innerJoin(leads, and(eq(leads.id, leadFollowups.leadId), eq(leads.organizationId, leadFollowups.organizationId), eq(leads.centreId, leadFollowups.centreId)))
      .where(and(eq(leadFollowups.id, reference.id), eq(leadFollowups.organizationId, staff.organizationId), eq(leadFollowups.centreId, centreId)))
      .limit(1);
    return row ? `Lead follow-up · ${row.leadNumber} · ${row.status} · ${row.dueAt.toLocaleString()}` : null;
  }
  if (reference.type === "PUBLIC_ENQUIRY") {
    const access = await getApiAccess("leads.read", centreId);
    if (access.response) return null;
    const [row] = await db.select({ number: publicEnquiries.enquiryNumber, status: publicEnquiries.status }).from(publicEnquiries)
      .where(and(eq(publicEnquiries.id, reference.id), eq(publicEnquiries.organizationId, staff.organizationId), eq(publicEnquiries.centreId, centreId))).limit(1);
    return row ? `Website enquiry ${row.number} · ${row.status}` : null;
  }
  if (reference.type === "CORPORATE_RELATIONSHIP" || reference.type === "PARTNER_RELATIONSHIP") {
    const type = reference.type === "CORPORATE_RELATIONSHIP" ? "CORPORATE" : "PARTNER";
    const access = await getApiAccess(type === "CORPORATE" ? "corporate.read" : "partners.read", centreId);
    if (access.response) return null;
    const result = await db.execute(sql`SELECT relationship_number AS "relationshipNumber", category, status FROM business_relationships WHERE id=${reference.id} AND organization_id=${staff.organizationId} AND centre_id=${centreId} AND relationship_type=${type} LIMIT 1`);
    const row = (result as unknown as Rows<{ relationshipNumber: string; category: string; status: string }>).rows[0];
    return row ? `${type === "CORPORATE" ? "Corporate" : "Partner"} relationship ${row.relationshipNumber} · ${row.category} · ${row.status}` : null;
  }
  if (reference.type === "DOCTOR_RELATIONSHIP") {
    const access = await getApiAccess("doctors.read", centreId);
    if (access.response) return null;
    const result = await db.execute(sql`SELECT doctor_number AS "doctorNumber", specialty, status FROM doctor_profiles WHERE id=${reference.id} AND organization_id=${staff.organizationId} AND centre_id=${centreId} LIMIT 1`);
    const row = (result as unknown as Rows<{ doctorNumber: string; specialty: string; status: string }>).rows[0];
    return row ? `Doctor relationship ${row.doctorNumber} · ${row.specialty} · ${row.status}` : null;
  }
  if (reference.type === "COLLECTION_JOB") {
    let access = await getApiAccess("collections.read", centreId);
    if (access.response) access = await getApiAccess("collections.visit.record", centreId);
    if (access.response) return null;
    const [row] = await db.select({ number: collectionJobs.jobNumber, status: collectionJobs.status, assignedStaffId: collectionJobs.assignedStaffId }).from(collectionJobs).where(and(eq(collectionJobs.id, reference.id), eq(collectionJobs.organizationId, staff.organizationId), eq(collectionJobs.centreId, centreId))).limit(1);
    const assignmentOnly = staff.grants.some((g) => g.key === "collections.visit.record" && (g.centreId === null || g.centreId === centreId)) && !staff.grants.some((g) => g.key === "collections.assign" && (g.centreId === null || g.centreId === centreId));
    if (!row || (assignmentOnly && row.assignedStaffId !== staff.staffUserId)) return null;
    return `${row.number} · ${row.status}`;
  }
  if (reference.type === "SAMPLE_EXCEPTION") {
    const access = await getApiAccess("samples.read", centreId);
    if (access.response) return null;
    const visibility = assignmentVisibility(staff.grants, "samples.read", "collections.assign", ["samples.collect", "collections.visit.record"]);
    const scope = assignmentVisibilityAtCentre(visibility, centreId);
    if (scope === "none") return null;
    const assignedOnly = scope === "assigned";
    const [row] = await db.select({ type: sampleExceptions.exceptionType, status: sampleExceptions.status }).from(sampleExceptions)
      .innerJoin(specimens, and(eq(specimens.id, sampleExceptions.specimenId), eq(specimens.organizationId, sampleExceptions.organizationId), eq(specimens.centreId, sampleExceptions.centreId)))
      .innerJoin(collectionJobs, and(eq(collectionJobs.id, specimens.jobId), eq(collectionJobs.organizationId, specimens.organizationId), eq(collectionJobs.centreId, specimens.centreId)))
      .where(and(eq(sampleExceptions.id, reference.id), eq(sampleExceptions.organizationId, staff.organizationId), eq(sampleExceptions.centreId, centreId), ...(assignedOnly ? [eq(collectionJobs.assignedStaffId, staff.staffUserId)] : []))).limit(1);
    return row ? `Sample exception · ${row.type} · ${row.status}` : null;
  }
  if (reference.type === "REPORT") {
    const access = await getApiAccess("reports.read", centreId);
    if (access.response) return null;
    const result = await db.execute(sql`SELECT report_number AS "reportNumber",status FROM diagnostic_reports WHERE id=${reference.id} AND organization_id=${staff.organizationId} AND centre_id=${centreId} LIMIT 1`);
    const row = (result as unknown as Rows<{ reportNumber: string; status: string }>).rows[0];
    return row ? `Report ${row.reportNumber} · ${row.status}` : null;
  }
  if (reference.type === "REPORT_FOLLOWUP") {
    const access = await getApiAccess("reports.followups.manage", centreId);
    if (access.response) return null;
    const result = await db.execute(sql`SELECT task_type AS "taskType",status,due_at AS "dueAt" FROM report_followups WHERE id=${reference.id} AND organization_id=${staff.organizationId} AND centre_id=${centreId} LIMIT 1`);
    const row = (result as unknown as Rows<{ taskType: string; status: string; dueAt: Date }>).rows[0];
    return row ? `Report follow-up · ${row.taskType} · ${row.status} · ${row.dueAt.toLocaleString()}` : null;
  }
  const access = await getApiAccess("finance.read", centreId);
  if (access.response) return null;
  if (reference.type === "FINANCE_PAYMENT") {
    const actionable = options.forEscalationCreation ? sql`AND status='DISPUTED'` : sql``;
    const result = await db.execute(sql`SELECT status FROM finance_payments WHERE id=${reference.id} AND organization_id=${staff.organizationId} AND centre_id=${centreId} ${actionable} LIMIT 1`);
    const row = (result as unknown as Rows<{ status: string }>).rows[0];
    return row ? `Payment · ${row.status}` : null;
  }
  const actionable = options.forEscalationCreation ? sql`AND status='REQUESTED'` : sql``;
  const result = await db.execute(sql`SELECT status FROM finance_refunds WHERE id=${reference.id} AND organization_id=${staff.organizationId} AND centre_id=${centreId} ${actionable} LIMIT 1`);
  const row = (result as unknown as Rows<{ status: string }>).rows[0];
  return row ? `Refund · ${row.status}` : null;
}
