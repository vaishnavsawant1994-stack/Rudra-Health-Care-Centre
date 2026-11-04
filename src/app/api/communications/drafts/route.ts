import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getApiAccess } from "@/server/access";
import { hasLeadCentrePermission } from "@/server/lead-policy";
import { leadCommunicationDrafts, leads, staffUsers } from "@/db/schema";

const querySchema = z.object({
  centreId: z.uuid(),
  purpose: z.enum(["ALL", "OPERATIONAL", "MARKETING"]).default("ALL"),
  channel: z.enum(["ALL", "PHONE", "EMAIL", "WHATSAPP"]).default("ALL"),
  page: z.coerce.number().int().min(1).max(10000).default(1),
});

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const { centreId, purpose, channel, page } = parsed.data;
  const access = await getApiAccess("leads.read", centreId);
  if (access.response) return access.response;
  if (!hasLeadCentrePermission(access.staff.grants, "leads.read", centreId)) return Response.json({ error: "not_found" }, { status: 404 });

  const where = and(
    eq(leadCommunicationDrafts.organizationId, access.staff.organizationId),
    eq(leadCommunicationDrafts.centreId, centreId),
    purpose === "ALL" ? undefined : eq(leadCommunicationDrafts.purpose, purpose),
    channel === "ALL" ? undefined : eq(leadCommunicationDrafts.channel, channel),
  );
  const rows = await getDb().select({
    id: leadCommunicationDrafts.id,
    leadId: leadCommunicationDrafts.leadId,
    leadNumber: leads.leadNumber,
    purpose: leadCommunicationDrafts.purpose,
    channel: leadCommunicationDrafts.channel,
    status: leadCommunicationDrafts.status,
    createdAt: leadCommunicationDrafts.createdAt,
    updatedAt: leadCommunicationDrafts.updatedAt,
    creatorName: staffUsers.displayName,
    creatorCode: staffUsers.staffCode,
  }).from(leadCommunicationDrafts)
    .innerJoin(leads, and(eq(leads.id, leadCommunicationDrafts.leadId), eq(leads.organizationId, leadCommunicationDrafts.organizationId), eq(leads.centreId, leadCommunicationDrafts.centreId)))
    .innerJoin(staffUsers, and(eq(staffUsers.id, leadCommunicationDrafts.createdByStaffId), eq(staffUsers.organizationId, leadCommunicationDrafts.organizationId)))
    .where(where).orderBy(desc(leadCommunicationDrafts.createdAt), desc(leadCommunicationDrafts.id))
    .limit(26).offset((page - 1) * 25);
  return Response.json({
    drafts: rows.slice(0, 25).map((row) => ({ ...row, canCancel: hasLeadCentrePermission(access.staff.grants, "leads.activities.write", centreId), creator: `${row.creatorName} (${row.creatorCode})` })),
    page,
    pageSize: 25,
    hasMore: rows.length > 25,
    delivery: "DISABLED",
  }, { headers: { "cache-control": "private, no-store" } });
}
