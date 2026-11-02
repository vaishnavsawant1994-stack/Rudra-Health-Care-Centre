import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { getDb } from "@/db/client";
import { leadFollowups, leads } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { hasLeadCentrePermission, leadContactAllowed, leadFollowupCreateSchema } from "@/server/lead-policy";
import { isAssignableStaff } from "@/server/lead-assignments";
import { addLeadActivity } from "@/server/lead-private";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = leadFollowupCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const access = await getApiAccess("leads.followups.manage");
  if (access.response) return access.response;
  const [lead] = await getDb().select().from(leads).where(and(eq(leads.id, id), eq(leads.organizationId, access.staff.organizationId))).limit(1);
  if (!lead || !hasLeadCentrePermission(access.staff.grants, "leads.followups.manage", lead.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (parsed.data.taskType === "CONTACT" && !leadContactAllowed({ status: lead.status, contactPermission: lead.contactPermission })) return Response.json({ error: "contact_permission_required" }, { status: 409 });
  const assignedStaffId = parsed.data.assignedStaffId ?? lead.assignedStaffId;
  if (parsed.data.assignedStaffId) {
    const assignmentAccess = await getApiAccess("leads.assign", lead.centreId);
    if (assignmentAccess.response) return assignmentAccess.response;
    if (!await isAssignableStaff(getDb(), assignedStaffId, lead.organizationId, lead.centreId)) return Response.json({ error: "invalid_assignee" }, { status: 400 });
  }
  try {
    const followup = await getDb().transaction(async (tx) => {
      const [lockedLead] = await tx.select().from(leads).where(and(eq(leads.id, id), eq(leads.organizationId, lead.organizationId))).for("update").limit(1);
      if (!lockedLead) throw new Error("lead_missing");
      if (parsed.data.taskType === "CONTACT" && !leadContactAllowed({ status: lockedLead.status, contactPermission: lockedLead.contactPermission })) throw new Error("contact_permission_changed");
      const [created] = await tx.insert(leadFollowups).values({ organizationId: lead.organizationId, centreId: lead.centreId, leadId: id, assignedStaffId, dueAt: new Date(parsed.data.dueAt), taskType: parsed.data.taskType, createdByStaffId: access.staff.staffUserId }).returning({ id: leadFollowups.id, dueAt: leadFollowups.dueAt, status: leadFollowups.status, assignedStaffId: leadFollowups.assignedStaffId });
      await addLeadActivity(tx, { organizationId: lead.organizationId, centreId: lead.centreId, leadId: id, actorStaffId: access.staff.staffUserId, activityType: "FOLLOW_UP_CREATED", body: parsed.data.note ?? null, metadata: { followupId: created.id, taskType: parsed.data.taskType, assignedStaffId } });
      await appendAuditEvent(tx, { organizationId: lead.organizationId, centreId: lead.centreId, actorStaffId: access.staff.staffUserId, action: "lead.followup.created", entityType: "lead", entityId: id, details: { followupId: created.id, dueAt: created.dueAt.toISOString(), taskType: parsed.data.taskType } });
      return created;
    });
    return Response.json({ followup }, { status: 201 });
  } catch { return Response.json({ error: "contact_permission_required_or_followup_unavailable" }, { status: 409 }); }
}
