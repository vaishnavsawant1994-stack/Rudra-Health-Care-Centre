import { createHash } from "node:crypto";
import { and, eq, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { getDb } from "@/db/client";
import { leadPrivateData, leads } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { getLeadDetail } from "@/server/lead-directory";
import { canTransitionLead, hasLeadCentrePermission, leadContactAllowed, leadContactStates, leadStatuses, leadUpdateSchema } from "@/server/lead-policy";
import { isAssignableStaff } from "@/server/lead-assignments";
import { blindIndexLeadContact, decryptLeadPrivateData } from "@/server/lead-crypto";
import { addLeadActivity, saveLeadPrivateData } from "@/server/lead-private";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("leads.read");
  if (access.response) return access.response;
  return getLeadDetail(access.staff, id);
}

export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = leadUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const access = await getApiAccess("leads.update");
  if (access.response) return access.response;
  const db = getDb();
  const [current] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.organizationId, access.staff.organizationId))).limit(1);
  if (!current || !hasLeadCentrePermission(access.staff.grants, "leads.update", current.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const [privateRow] = await db.select({ payloadCiphertext: leadPrivateData.payloadCiphertext }).from(leadPrivateData).where(and(eq(leadPrivateData.leadId, id), eq(leadPrivateData.organizationId, current.organizationId), eq(leadPrivateData.centreId, current.centreId))).limit(1);
  if (!privateRow) return Response.json({ error: "not_found" }, { status: 404 });
  const currentPrivate = decryptLeadPrivateData(privateRow.payloadCiphertext, { organizationId: current.organizationId, centreId: current.centreId, recordId: current.id });
  const update = parsed.data;
  if (update.assignedStaffId && update.assignedStaffId !== current.assignedStaffId) {
    const grant = await getApiAccess("leads.assign", current.centreId);
    if (grant.response) return grant.response;
    if (!await isAssignableStaff(db, update.assignedStaffId, access.staff.organizationId, current.centreId)) return Response.json({ error: "invalid_assignee" }, { status: 400 });
  }
  if (update.marketingConsent !== undefined) {
    const grant = await getApiAccess("leads.marketing_consent", current.centreId);
    if (grant.response) return grant.response;
  }
  const nextContactPermission = update.contactPermission ?? current.contactPermission;
  if (update.status && update.status !== current.status) {
    if (update.status === "NEW") {
      const reopenAccess = await getApiAccess("leads.reopen", current.centreId);
      if (reopenAccess.response) return reopenAccess.response;
    }
    if (!canTransitionLead({ from: current.status as (typeof leadStatuses)[number], to: update.status, canReopen: hasLeadCentrePermission(access.staff.grants, "leads.reopen", current.centreId), contactPermission: nextContactPermission as (typeof leadContactStates)[number], hasContactEvidence: Boolean(update.contactEvidenceReference ?? currentPrivate.contactEvidenceReference) })) return Response.json({ error: "invalid_status_transition" }, { status: 409 });
    if (update.status === "CONTACTED" && !leadContactAllowed({ status: current.status, contactPermission: nextContactPermission })) return Response.json({ error: "contact_permission_required" }, { status: 409 });
    if (update.status === "CONVERTED") return Response.json({ error: "use_conversion_workflow" }, { status: 409 });
  }
  const resultingPhone = update.phone === undefined ? currentPrivate.phone : update.phone;
  const resultingEmail = update.email === undefined ? currentPrivate.email : update.email;
  if (!resultingPhone && !resultingEmail) return Response.json({ error: "contact_method_required" }, { status: 400 });
  if (update.duplicateOfLeadId) {
    const [duplicate] = await db.select({ id: leads.id }).from(leads).where(and(eq(leads.id, update.duplicateOfLeadId), eq(leads.organizationId, current.organizationId), eq(leads.centreId, current.centreId))).limit(1);
    if (!duplicate || duplicate.id === id) return Response.json({ error: "duplicate_lead_not_found" }, { status: 404 });
  }
  try {
    const saved = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(leads).where(and(eq(leads.id, id), eq(leads.organizationId, current.organizationId))).for("update").limit(1);
      if (!locked || locked.status === "CONVERTED") throw new Error("lead_closed");
      if (update.source !== undefined && update.source !== locked.source && (locked.sourceDoctorId || locked.sourceRelationshipId)) throw new Error("source_attribution_locked");
      const effectiveStatus = update.status ?? (update.contactPermission === "DO_NOT_CONTACT" ? "DO_NOT_CONTACT" : locked.status);
      const effectiveContactPermission = effectiveStatus === "DO_NOT_CONTACT" ? "DO_NOT_CONTACT" : update.contactPermission ?? locked.contactPermission;
      if (update.status && update.status !== locked.status && !canTransitionLead({ from: locked.status as (typeof leadStatuses)[number], to: update.status, canReopen: hasLeadCentrePermission(access.staff.grants, "leads.reopen", locked.centreId), contactPermission: effectiveContactPermission as (typeof leadContactStates)[number], hasContactEvidence: Boolean(update.contactEvidenceReference ?? currentPrivate.contactEvidenceReference) })) throw new Error("lead_status_changed");
      if (effectiveStatus === "CONTACTED" && !leadContactAllowed({ status: effectiveStatus, contactPermission: effectiveContactPermission })) throw new Error("contact_permission_required");
      if (effectiveStatus === "CONVERTED") throw new Error("use_conversion_workflow");
      const phone = update.phone === undefined ? currentPrivate.phone : update.phone;
      const email = update.email === undefined ? currentPrivate.email : update.email?.toLowerCase() ?? null;
      if (!phone && !email) throw new Error("contact_required");
      const identityLocks = [phone ? `phone:${phone}` : null, email ? `email:${email}` : null].filter((value): value is string => value !== null).sort();
      for (const identity of identityLocks) {
        const lockKey = createHash("sha256").update(`${locked.organizationId}:${locked.centreId}:${identity}`).digest("hex");
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      }
      const identityMatches = [phone ? eq(leadPrivateData.phoneBlindIndex, blindIndexLeadContact("phone", phone)) : undefined, email ? eq(leadPrivateData.emailBlindIndex, blindIndexLeadContact("email", email)) : undefined].filter((item): item is NonNullable<typeof item> => Boolean(item));
      if (identityMatches.length) {
        const [duplicate] = await tx.select({ leadId: leadPrivateData.leadId }).from(leadPrivateData).where(and(eq(leadPrivateData.organizationId, locked.organizationId), eq(leadPrivateData.centreId, locked.centreId), ne(leadPrivateData.leadId, id), or(...identityMatches)!)).limit(1);
        if (duplicate) throw new Error("possible_duplicate_review_required");
      }
      const contactState = update.status === "DO_NOT_CONTACT" ? "DO_NOT_CONTACT" : update.contactPermission ?? locked.contactPermission;
      const values = {
        ...(update.enquiryCategory !== undefined ? { enquiryCategory: update.enquiryCategory } : {}),
        ...(update.homeCollectionInterest !== undefined ? { homeCollectionInterest: update.homeCollectionInterest } : {}), ...(update.source !== undefined ? { source: update.source } : {}),
        ...(update.priority !== undefined ? { priority: update.priority } : {}),
        ...(update.assignedStaffId !== undefined ? { assignedStaffId: update.assignedStaffId } : {}), ...(update.preferredChannel !== undefined ? { preferredChannel: update.preferredChannel } : {}),
        ...(effectiveStatus !== locked.status ? { status: effectiveStatus } : {}), ...(update.status === "DO_NOT_CONTACT" || update.contactPermission !== undefined ? { contactPermission: contactState } : {}),
        ...(update.contactPermission !== undefined ? { contactPermissionRecordedBy: access.staff.staffUserId, contactPermissionRecordedAt: new Date() } : {}),
        ...(update.marketingConsent !== undefined ? { marketingConsent: update.marketingConsent, marketingConsentRecordedBy: access.staff.staffUserId, marketingConsentRecordedAt: new Date() } : {}),
        ...(update.duplicateOfLeadId !== undefined ? { duplicateOfLeadId: update.duplicateOfLeadId } : {}), updatedAt: new Date(),
      };
      const [row] = await tx.update(leads).set(values).where(eq(leads.id, id)).returning({ id: leads.id, status: leads.status, assignedStaffId: leads.assignedStaffId, contactPermission: leads.contactPermission, marketingConsent: leads.marketingConsent });
      await saveLeadPrivateData(tx, { organizationId: locked.organizationId, centreId: locked.centreId, recordId: id }, { ...currentPrivate, firstName: update.firstName ?? currentPrivate.firstName, lastName: update.lastName ?? currentPrivate.lastName, phone, email, interestedService: update.interestedService === undefined ? currentPrivate.interestedService : update.interestedService, campaign: update.campaign === undefined ? currentPrivate.campaign : update.campaign, contactEvidenceReference: update.contactEvidenceReference ?? currentPrivate.contactEvidenceReference, marketingEvidenceReference: update.marketingEvidenceReference ?? currentPrivate.marketingEvidenceReference, lostReason: update.lostReason ?? currentPrivate.lostReason });
      if (effectiveStatus !== locked.status) await addLeadActivity(tx, { organizationId: locked.organizationId, centreId: locked.centreId, leadId: id, actorStaffId: access.staff.staffUserId, activityType: effectiveStatus === "NEW" ? "REOPENED" : "STATUS_CHANGED", metadata: { from: locked.status, to: effectiveStatus, reason: update.statusReason ?? "Status adjusted as part of authorization update" } });
      if (update.contactPermission !== undefined) await addLeadActivity(tx, { organizationId: locked.organizationId, centreId: locked.centreId, leadId: id, actorStaffId: access.staff.staffUserId, activityType: "CONSENT_CHANGED", metadata: { consentType: "OPERATIONAL_CONTACT", state: update.contactPermission } });
      if (update.marketingConsent !== undefined) await addLeadActivity(tx, { organizationId: locked.organizationId, centreId: locked.centreId, leadId: id, actorStaffId: access.staff.staffUserId, activityType: "CONSENT_CHANGED", metadata: { consentType: "MARKETING", state: update.marketingConsent } });
      if (update.assignedStaffId !== undefined && update.assignedStaffId !== locked.assignedStaffId) await addLeadActivity(tx, { organizationId: locked.organizationId, centreId: locked.centreId, leadId: id, actorStaffId: access.staff.staffUserId, activityType: "ASSIGNED", metadata: { assignedStaffId: update.assignedStaffId } });
      if (update.status !== undefined || update.assignedStaffId !== undefined || update.contactPermission !== undefined || update.marketingConsent !== undefined || update.lostReason !== undefined || update.duplicateOfLeadId !== undefined) await appendAuditEvent(tx, { organizationId: locked.organizationId, centreId: locked.centreId, actorStaffId: access.staff.staffUserId, action: "lead.updated", entityType: "lead", entityId: id, details: { status: row.status, assigned: update.assignedStaffId !== undefined, contactPermissionChanged: update.contactPermission !== undefined, marketingConsentChanged: update.marketingConsent !== undefined } });
      else await appendAuditEvent(tx, { organizationId: locked.organizationId, centreId: locked.centreId, actorStaffId: access.staff.staffUserId, action: "lead.updated", entityType: "lead", entityId: id, details: { updatedFields: Object.keys(update).sort().join(",") } });
      return row;
    });
    return Response.json({ lead: saved });
  } catch (error) {
    if (error instanceof Error && error.message === "contact_required") return Response.json({ error: "contact_method_required" }, { status: 400 });
    if (error instanceof Error && error.message === "possible_duplicate_review_required") return Response.json({ error: "possible_duplicate_review_required" }, { status: 409 });
    if (error instanceof Error && error.message === "contact_permission_required") return Response.json({ error: "contact_permission_required" }, { status: 409 });
    if (error instanceof Error && error.message === "lead_status_changed") return Response.json({ error: "invalid_status_transition" }, { status: 409 });
    if (error instanceof Error && error.message === "use_conversion_workflow") return Response.json({ error: "use_conversion_workflow" }, { status: 409 });
    if (error instanceof Error && error.message === "source_attribution_locked") return Response.json({ error: "source_attribution_locked" }, { status: 409 });
    return Response.json({ error: "lead_update_conflict_or_unavailable" }, { status: 409 });
  }
}
