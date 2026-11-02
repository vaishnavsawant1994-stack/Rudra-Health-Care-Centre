import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { getDb } from "@/db/client";
import { leads } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { hasLeadCentrePermission, leadActivitySchema, leadContactAllowed } from "@/server/lead-policy";
import { addLeadActivity } from "@/server/lead-private";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = leadActivitySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const access = await getApiAccess("leads.activities.write");
  if (access.response) return access.response;
  const [initial] = await getDb().select().from(leads).where(and(eq(leads.id, id), eq(leads.organizationId, access.staff.organizationId))).limit(1);
  if (!initial || !hasLeadCentrePermission(access.staff.grants, "leads.activities.write", initial.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (parsed.data.activityType === "CONTACT_ATTEMPT" && !leadContactAllowed({ status: initial.status, contactPermission: initial.contactPermission })) return Response.json({ error: "contact_permission_required" }, { status: 409 });
  try {
    const result = await getDb().transaction(async (tx) => {
      const [lead] = await tx.select().from(leads).where(and(eq(leads.id, id), eq(leads.organizationId, access.staff.organizationId))).for("update").limit(1);
      if (!lead || (parsed.data.activityType === "CONTACT_ATTEMPT" && !leadContactAllowed({ status: lead.status, contactPermission: lead.contactPermission }))) throw new Error("contact_permission_changed");
      const activityId = await addLeadActivity(tx, { organizationId: lead.organizationId, centreId: lead.centreId, leadId: lead.id, actorStaffId: access.staff.staffUserId, activityType: parsed.data.activityType, body: parsed.data.body, metadata: parsed.data.activityType === "CONTACT_ATTEMPT" ? { outcome: parsed.data.outcome } : {} });
      await appendAuditEvent(tx, { organizationId: lead.organizationId, centreId: lead.centreId, actorStaffId: access.staff.staffUserId, action: parsed.data.activityType === "CONTACT_ATTEMPT" ? "lead.contact_attempt" : "lead.note_added", entityType: "lead", entityId: lead.id, details: { activityId, activityType: parsed.data.activityType, ...(parsed.data.activityType === "CONTACT_ATTEMPT" ? { outcome: parsed.data.outcome } : {}) } });
      return { id: activityId, activityType: parsed.data.activityType, recordedAt: new Date() };
    });
    return Response.json({ activity: result }, { status: 201 });
  } catch { return Response.json({ error: "contact_permission_required_or_activity_unavailable" }, { status: 409 }); }
}
