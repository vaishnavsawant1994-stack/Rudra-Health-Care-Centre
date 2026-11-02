import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { getDb } from "@/db/client";
import { leadPrivateData, leads, marketingCampaigns } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { hasLeadCentrePermission, leadCreateSchema, leadSources, leadStatuses } from "@/server/lead-policy";
import { searchAuthorizedLeads } from "@/server/lead-directory";
import { isAssignableStaff } from "@/server/lead-assignments";
import { blindIndexLeadContact } from "@/server/lead-crypto";
import { addLeadActivity, saveLeadPrivateData } from "@/server/lead-private";
import { hasPermission } from "@/server/permissions";

const listSchema = z.object({
  centreId: z.uuid().optional(), status: z.enum(leadStatuses).optional(), source: z.enum(leadSources).optional(), assignedStaffId: z.uuid().optional(),
  page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(25),
});

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.has("q")) return Response.json({ error: "search_requires_post" }, { status: 400 });
  const parsed = listSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const centreId = parsed.data.centreId;
  const access = await getApiAccess("leads.read", centreId);
  if (access.response) return access.response;
  return searchAuthorizedLeads(access.staff, parsed.data);
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const parsed = leadCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const access = await getApiAccess("leads.create", parsed.data.centreId);
  if (access.response) return access.response;
  const relationshipType = parsed.data.source === "CORPORATE" ? "CORPORATE" : parsed.data.source === "PARTNER" ? "PARTNER" : null;
  if (parsed.data.sourceRelationshipId && !relationshipType) return Response.json({ error: "source_relationship_type_mismatch" }, { status: 400 });
  if (parsed.data.sourceDoctorId && (parsed.data.source !== "REFERRAL" || parsed.data.sourceRelationshipId)) return Response.json({ error: "source_relationship_type_mismatch" }, { status: 400 });
  if (parsed.data.sourceRelationshipId && relationshipType) {
    const relationshipAccess = await getApiAccess(relationshipType === "CORPORATE" ? "corporate.read" : "partners.read", parsed.data.centreId);
    if (relationshipAccess.response) return relationshipAccess.response;
  }
  if (parsed.data.sourceDoctorId) {
    const doctorAccess = await getApiAccess("doctors.read", parsed.data.centreId);
    if (doctorAccess.response) return doctorAccess.response;
  }
  if (parsed.data.marketingCampaignId) {
    if (parsed.data.source !== "CAMPAIGN" || !hasPermission(access.staff.grants, "marketing.read", parsed.data.centreId)) return Response.json({ error: "campaign_attribution_not_authorized" }, { status: 403 });
  }
  const assignedStaffId = parsed.data.assignedStaffId ?? access.staff.staffUserId;
  if (parsed.data.assignedStaffId) {
    const assignmentAccess = await getApiAccess("leads.assign", parsed.data.centreId);
    if (assignmentAccess.response) return assignmentAccess.response;
    if (!hasLeadCentrePermission(access.staff.grants, "leads.assign", parsed.data.centreId) || !await isAssignableStaff(getDb(), assignedStaffId, access.staff.organizationId, parsed.data.centreId)) return Response.json({ error: "invalid_assignee" }, { status: 403 });
  }
  const email = parsed.data.email?.trim().toLowerCase() || null;
  const phone = parsed.data.phone?.trim() ?? null;
  const db = getDb();
  try {
    const result = await db.transaction(async (tx) => {
      if (parsed.data.sourceRelationshipId && relationshipType) {
        const relationship = await tx.execute(sql`SELECT id FROM business_relationships WHERE id = ${parsed.data.sourceRelationshipId} AND organization_id = ${access.staff.organizationId} AND centre_id = ${parsed.data.centreId} AND relationship_type = ${relationshipType} AND status = 'ACTIVE' LIMIT 1`);
        if (!relationship.rows.length) throw new Error("source_relationship_unavailable");
      }
      if (parsed.data.sourceDoctorId) {
        const doctor = await tx.execute(sql`SELECT id FROM doctor_profiles WHERE id = ${parsed.data.sourceDoctorId} AND organization_id = ${access.staff.organizationId} AND centre_id = ${parsed.data.centreId} AND status = 'ACTIVE' LIMIT 1`);
        if (!doctor.rows.length) throw new Error("source_doctor_unavailable");
      }
      if (parsed.data.marketingCampaignId) {
        const [campaign] = await tx.select({ id: marketingCampaigns.id }).from(marketingCampaigns).where(and(eq(marketingCampaigns.id, parsed.data.marketingCampaignId), eq(marketingCampaigns.organizationId, access.staff.organizationId), eq(marketingCampaigns.centreId, parsed.data.centreId), eq(marketingCampaigns.status, "ACTIVE"))).limit(1);
        if (!campaign) throw new Error("campaign_attribution_unavailable");
      }
      const identityLocks = [phone ? `phone:${phone}` : null, email ? `email:${email}` : null].filter((value): value is string => value !== null).sort();
      for (const identity of identityLocks) {
        const lockKey = createHash("sha256").update(`${access.staff.organizationId}:${parsed.data.centreId}:${identity}`).digest("hex");
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      }
      const [duplicate] = await tx.select({ id: leadPrivateData.leadId }).from(leadPrivateData).where(and(
        eq(leadPrivateData.organizationId, access.staff.organizationId), eq(leadPrivateData.centreId, parsed.data.centreId),
        sql`(${phone ? sql`${leadPrivateData.phoneBlindIndex} = ${blindIndexLeadContact("phone", phone)}` : sql`false`} OR ${email ? sql`${leadPrivateData.emailBlindIndex} = ${blindIndexLeadContact("email", email)}` : sql`false`})`,
      )).limit(1);
      if (duplicate) throw new Error("possible_duplicate_review_required");
      const id = randomUUID();
      const leadNumber = `RHC-L-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`;
      const [created] = await tx.insert(leads).values({
        id, organizationId: access.staff.organizationId, centreId: parsed.data.centreId, leadNumber,
        enquiryCategory: parsed.data.enquiryCategory, homeCollectionInterest: parsed.data.homeCollectionInterest,
        source: parsed.data.source, sourceRelationshipId: parsed.data.sourceRelationshipId ?? null, sourceRelationshipType: parsed.data.sourceRelationshipId ? relationshipType : null, sourceDoctorId: parsed.data.sourceDoctorId ?? null, marketingCampaignId: parsed.data.marketingCampaignId ?? null,
        status: "NEW", priority: parsed.data.priority, assignedStaffId,
        preferredChannel: parsed.data.preferredChannel, createdByStaffId: access.staff.staffUserId,
      }).returning({ id: leads.id, leadNumber: leads.leadNumber, status: leads.status });
      await saveLeadPrivateData(tx, { organizationId: access.staff.organizationId, centreId: parsed.data.centreId, recordId: id }, { firstName: parsed.data.firstName, lastName: parsed.data.lastName, phone, email, interestedService: parsed.data.interestedService ?? null, campaign: parsed.data.campaign ?? null, contactEvidenceReference: null, marketingEvidenceReference: null, lostReason: null });
      await addLeadActivity(tx, { organizationId: access.staff.organizationId, centreId: parsed.data.centreId, leadId: id, actorStaffId: access.staff.staffUserId, activityType: "CREATED", metadata: { source: parsed.data.source, sourceRelationshipLinked: Boolean(parsed.data.sourceRelationshipId || parsed.data.sourceDoctorId), sourceRelationshipType: parsed.data.sourceDoctorId ? "DOCTOR" : parsed.data.sourceRelationshipId ? relationshipType : null } });
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: parsed.data.centreId, actorStaffId: access.staff.staffUserId, action: "lead.created", entityType: "lead", entityId: id, details: { status: "NEW", source: parsed.data.source, category: parsed.data.enquiryCategory, sourceRelationshipLinked: Boolean(parsed.data.sourceRelationshipId || parsed.data.sourceDoctorId), sourceRelationshipType: parsed.data.sourceDoctorId ? "DOCTOR" : parsed.data.sourceRelationshipId ? relationshipType : null } });
      return created;
    });
    return Response.json({ lead: result }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "possible_duplicate_review_required") return Response.json({ error: "possible_duplicate_review_required" }, { status: 409 });
    if (error instanceof Error && error.message === "source_relationship_unavailable") return Response.json({ error: "source_relationship_unavailable" }, { status: 404 });
    if (error instanceof Error && error.message === "source_doctor_unavailable") return Response.json({ error: "source_doctor_unavailable" }, { status: 404 });
    if (error instanceof Error && error.message === "campaign_attribution_unavailable") return Response.json({ error: "campaign_attribution_unavailable" }, { status: 404 });
    return Response.json({ error: "lead_creation_unavailable" }, { status: 409 });
  }
}
