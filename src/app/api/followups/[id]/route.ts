import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { getDb } from "@/db/client";
import { leadFollowups, leads } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { hasLeadCentrePermission, leadContactAllowed, leadFollowupUpdateSchema } from "@/server/lead-policy";
import { isAssignableStaff } from "@/server/lead-assignments";
import { addLeadActivity } from "@/server/lead-private";
import { encryptLeadValue } from "@/server/lead-crypto";

type Context = { params: Promise<{ id: string }> };
const outreachOutcomes = ["CONTACTED", "NO_ANSWER", "CALLBACK_REQUESTED", "NOT_INTERESTED"];

export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = leadFollowupUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const access = await getApiAccess("leads.followups.manage");
  if (access.response) return access.response;
  const db = getDb();
  const [current] = await db.select({ id: leadFollowups.id, leadId: leadFollowups.leadId, organizationId: leadFollowups.organizationId, centreId: leadFollowups.centreId, assignedStaffId: leadFollowups.assignedStaffId, status: leadFollowups.status, taskType: leadFollowups.taskType })
    .from(leadFollowups).where(and(eq(leadFollowups.id, id), eq(leadFollowups.organizationId, access.staff.organizationId))).limit(1);
  if (!current || !hasLeadCentrePermission(access.staff.grants, "leads.followups.manage", current.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const update = parsed.data;
  if (update.assignedStaffId && update.assignedStaffId !== current.assignedStaffId) {
    const assign = await getApiAccess("leads.assign", current.centreId);
    if (assign.response) return assign.response;
    if (!await isAssignableStaff(db, update.assignedStaffId, current.organizationId, current.centreId)) return Response.json({ error: "invalid_assignee" }, { status: 400 });
  }
  try {
    const result = await db.transaction(async (tx) => {
      const [lead] = await tx.select().from(leads).where(and(eq(leads.id, current.leadId), eq(leads.organizationId, current.organizationId))).for("update").limit(1);
      const [task] = await tx.select().from(leadFollowups).where(and(eq(leadFollowups.id, id), eq(leadFollowups.organizationId, current.organizationId))).for("update").limit(1);
      if (!lead || !task || task.status !== "SCHEDULED") throw new Error("followup_closed");
      if ((task.taskType === "CONTACT" || (update.outcome && outreachOutcomes.includes(update.outcome))) && !leadContactAllowed({ status: lead.status, contactPermission: lead.contactPermission })) throw new Error("contact_permission_required");
      const completed = update.status === "COMPLETED" || update.status === "UNSUCCESSFUL";
      const outcomeNoteCiphertext = update.outcomeNote === undefined ? undefined : update.outcomeNote === null ? null : encryptLeadValue("followup-note", update.outcomeNote, { organizationId: current.organizationId, centreId: current.centreId, recordId: id });
      const [updated] = await tx.update(leadFollowups).set({
        ...(update.dueAt ? { dueAt: new Date(update.dueAt) } : {}), ...(update.assignedStaffId ? { assignedStaffId: update.assignedStaffId } : {}),
        ...(update.status ? { status: update.status } : {}), ...(update.outcome ? { outcome: update.outcome } : {}), ...(outcomeNoteCiphertext !== undefined ? { outcomeNoteCiphertext } : {}),
        ...(completed ? { completedByStaffId: access.staff.staffUserId, completedAt: new Date() } : {}), updatedAt: new Date(),
      }).where(and(eq(leadFollowups.id, id), eq(leadFollowups.status, "SCHEDULED"))).returning({ id: leadFollowups.id, status: leadFollowups.status, dueAt: leadFollowups.dueAt, outcome: leadFollowups.outcome });
      if (!updated) throw new Error("followup_changed");
      await addLeadActivity(tx, { organizationId: current.organizationId, centreId: current.centreId, leadId: lead.id, actorStaffId: access.staff.staffUserId, activityType: completed ? "FOLLOW_UP_COMPLETED" : "UPDATED", body: update.outcomeNote ?? null, metadata: { followupId: id, status: updated.status, outcome: updated.outcome, dueAt: updated.dueAt.toISOString(), assigned: update.assignedStaffId !== undefined } });
      await appendAuditEvent(tx, { organizationId: current.organizationId, centreId: current.centreId, actorStaffId: access.staff.staffUserId, action: completed ? "lead.followup.completed" : update.status === "CANCELLED" ? "lead.followup.cancelled" : "lead.followup.updated", entityType: "lead", entityId: lead.id, details: { followupId: id, status: updated.status, outcome: updated.outcome, assigned: update.assignedStaffId !== undefined } });
      return updated;
    });
    return Response.json({ followup: result });
  } catch (error) {
    if (error instanceof Error && error.message === "contact_permission_required") return Response.json({ error: "contact_permission_required" }, { status: 409 });
    return Response.json({ error: "followup_closed_or_update_unavailable" }, { status: 409 });
  }
}
