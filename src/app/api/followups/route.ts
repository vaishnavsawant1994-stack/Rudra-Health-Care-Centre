import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres, leadFollowups, leadPrivateData, leads, staffUsers } from "@/db/schema";
import { decryptLeadPrivateData, decryptLeadValue } from "@/server/lead-crypto";
import { hasLeadCentrePermission, visibleLeadCentres } from "@/server/lead-policy";

const schema = z.object({ centreId: z.uuid().optional(), followupId: z.uuid().optional(), status: z.enum(["SCHEDULED", "COMPLETED", "UNSUCCESSFUL", "CANCELLED"]).optional(), assignedStaffId: z.uuid().optional(), window: z.enum(["ALL", "UPCOMING", "OVERDUE"]).default("ALL") });

export async function GET(request: Request) {
  const parsed = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const centreId = parsed.data.centreId;
  const access = await getApiAccess("leads.followups.manage", centreId);
  if (access.response) return access.response;
  const allowed = visibleLeadCentres(access.staff.grants, "leads.followups.manage");
  const readable = visibleLeadCentres(access.staff.grants, "leads.read");
  if (centreId && !hasLeadCentrePermission(access.staff.grants, "leads.followups.manage", centreId)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (centreId && !hasLeadCentrePermission(access.staff.grants, "leads.read", centreId)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!centreId && allowed !== null && allowed.length === 0 || !centreId && readable !== null && readable.length === 0) return Response.json({ followups: [] });
  const conditions = [eq(leadFollowups.organizationId, access.staff.organizationId)];
  if (centreId) conditions.push(eq(leadFollowups.centreId, centreId));
  else if (allowed !== null && readable !== null) conditions.push(inArray(leadFollowups.centreId, allowed.filter((id) => readable.includes(id))));
  else if (allowed !== null) conditions.push(inArray(leadFollowups.centreId, allowed));
  else if (readable !== null) conditions.push(inArray(leadFollowups.centreId, readable));
  if (parsed.data.status) conditions.push(eq(leadFollowups.status, parsed.data.status));
  if (parsed.data.followupId) conditions.push(eq(leadFollowups.id, parsed.data.followupId));
  if (parsed.data.assignedStaffId) conditions.push(eq(leadFollowups.assignedStaffId, parsed.data.assignedStaffId));
  if (parsed.data.window === "UPCOMING") conditions.push(sql`${leadFollowups.status} = 'SCHEDULED' AND ${leadFollowups.dueAt} >= now()`);
  if (parsed.data.window === "OVERDUE") conditions.push(sql`${leadFollowups.status} = 'SCHEDULED' AND ${leadFollowups.dueAt} < now()`);
  const rows = await getDb().select({ id: leadFollowups.id, leadId: leads.id, leadNumber: leads.leadNumber, leadPrivateCiphertext: leadPrivateData.payloadCiphertext, leadStatus: leads.status, centreId: leadFollowups.centreId, centreName: centres.name, assignedStaffId: leadFollowups.assignedStaffId, assignedStaffName: staffUsers.displayName, dueAt: leadFollowups.dueAt, status: leadFollowups.status, taskType: leadFollowups.taskType, outcome: leadFollowups.outcome, outcomeNoteCiphertext: leadFollowups.outcomeNoteCiphertext })
    .from(leadFollowups).innerJoin(leads, and(eq(leads.id, leadFollowups.leadId), eq(leads.organizationId, leadFollowups.organizationId))).innerJoin(leadPrivateData, and(eq(leadPrivateData.leadId, leads.id), eq(leadPrivateData.organizationId, leads.organizationId), eq(leadPrivateData.centreId, leads.centreId))).innerJoin(centres, and(eq(centres.id, leadFollowups.centreId), eq(centres.organizationId, leadFollowups.organizationId))).innerJoin(staffUsers, and(eq(staffUsers.id, leadFollowups.assignedStaffId), eq(staffUsers.organizationId, leadFollowups.organizationId))).where(and(...conditions)).orderBy(asc(leadFollowups.dueAt)).limit(200);
  return Response.json({ followups: rows.map(({leadPrivateCiphertext,outcomeNoteCiphertext,...row})=>({ ...row, leadName: (()=>{const value=decryptLeadPrivateData(leadPrivateCiphertext,{organizationId:access.staff.organizationId,centreId:row.centreId,recordId:row.leadId});return `${value.firstName} ${value.lastName}`;})(), outcomeNote:outcomeNoteCiphertext?decryptLeadValue<string>("followup-note",outcomeNoteCiphertext,{organizationId:access.staff.organizationId,centreId:row.centreId,recordId:row.id}):null })) });
}
