import { createHash, randomUUID } from "node:crypto";
import { and, asc, desc, eq, gte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { centres, organizations, publicEnquiries, publicEnquiryEvents } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { isSameOriginRequest, csrfRejected } from "@/server/csrf";
import { blindIndexLeadContact, decryptLeadValue, encryptLeadValue, type LeadPrivateData } from "@/server/lead-crypto";
import { addLeadActivity, saveLeadPrivateData } from "@/server/lead-private";
import { getPublicCatalogueItem } from "@/server/public-catalogue";
import { listPublicEnquiryCentres } from "@/server/public-enquiry-centres";
import { formatPublicCampaignAttribution, publicEnquiryContext, publicEnquiryCreateSchema, publicEnquiryFingerprint, publicEnquiryRequestContext, publicEnquiryReviewSchema, verifyPublicEnquiryFingerprint, type PublicEnquiryPayload } from "@/server/public-enquiry-policy";
import { leads, leadPrivateData, marketingCampaigns } from "@/db/schema";
import { hasLeadCentrePermission } from "@/server/lead-policy";
import { isAssignableStaff } from "@/server/lead-assignments";
import { sealBusinessRelationship, sealBusinessRelationshipEvent, type BusinessRelationshipType, type BusinessRelationshipPrivateData } from "@/server/business-relationship-data";

const reviewQuery = z.object({ centreId: z.uuid(), status: z.enum(["PENDING_REVIEW", "CONVERTED_TO_LEAD", "CONVERTED_TO_RELATIONSHIP", "DISMISSED"]).default("PENDING_REVIEW"), page: z.coerce.number().int().min(1).max(10000).default(1), summary: z.enum(["true"]).optional() });
const PUBLIC_CONTACT_SUBMISSION_LIMIT = 5;
const PUBLIC_CONTACT_SUBMISSION_WINDOW_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > 16_384) return Response.json({ error: "invalid_input" }, { status: 413 });
  const parsed = publicEnquiryCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!idempotencyKey || !z.uuid().safeParse(idempotencyKey).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  if (parsed.data.website) return Response.json({ accepted: true }, { status: 202 });
  try {
    const enquiryCentres = await listPublicEnquiryCentres();
    if (!enquiryCentres.some((centre) => centre.id === parsed.data.centreId)) return Response.json({ error: "centre_unavailable" }, { status: 400 });
    let selectedService: Awaited<ReturnType<typeof getPublicCatalogueItem>> = null;
    if (parsed.data.requestedCatalogueItemId) {
      selectedService = await getPublicCatalogueItem(parsed.data.requestedCatalogueItemId);
      if (!selectedService || selectedService.centreId !== parsed.data.centreId || selectedService.version !== parsed.data.requestedCatalogueVersion) {
        return Response.json({ error: "catalogue_selection_unavailable" }, { status: 400 });
      }
    }
    const [scope] = await getDb().select({ organizationId: centres.organizationId }).from(centres).innerJoin(organizations, eq(organizations.id, centres.organizationId)).where(and(eq(centres.id, parsed.data.centreId), eq(centres.status, "ACTIVE"), eq(organizations.status, "ACTIVE"))).limit(1);
    if (!scope) return Response.json({ error: "centre_unavailable" }, { status: 400 });
    const payload: PublicEnquiryPayload = {
      firstName: parsed.data.firstName, lastName: parsed.data.lastName, organizationName: parsed.data.organizationName?.trim() || null,
      phone: parsed.data.phone?.trim().replace(/[ ()-]/g, "") || null,
      email: parsed.data.email?.trim().toLowerCase() || null,
      category: parsed.data.category, requestTopic: parsed.data.requestTopic, message: parsed.data.message,
      requestKind: parsed.data.requestKind,
      requestedService: selectedService ? `${selectedService.displayName} (${selectedService.serviceCode})` : parsed.data.requestedService || null,
      requestedCatalogueItemId: selectedService?.id ?? null,
      requestedCatalogueVersion: selectedService?.version ?? null,
      campaignAttribution: parsed.data.campaignAttribution ?? null,
      preferredDate: parsed.data.preferredDate || null,
      preferredTimeWindow: parsed.data.preferredTimeWindow || null,
      visitType: parsed.data.visitType ?? null,
      collectionAddress: parsed.data.visitType === "HOME_COLLECTION" ? {
        line1: parsed.data.addressLine1!, ...(parsed.data.addressLine2 ? { line2: parsed.data.addressLine2 } : {}),
        city: parsed.data.city!, state: parsed.data.state!, postalCode: parsed.data.postalCode!,
      } : null,
      responsePermission: parsed.data.responsePermission,
      responsePermissionTextVersion: "PUBLIC_ENQUIRY_RESPONSE_V1", submittedAt: new Date().toISOString(),
    };
    const requestContext = publicEnquiryRequestContext({ organizationId: scope.organizationId, centreId: parsed.data.centreId, idempotencyKey });
    const requestForFingerprint = { ...payload, submittedAt: undefined };
    const fingerprint = publicEnquiryFingerprint(requestForFingerprint, requestContext);
    const phoneBlindIndex = payload.phone ? blindIndexLeadContact("phone", payload.phone) : null;
    const emailBlindIndex = payload.email ? blindIndexLeadContact("email", payload.email) : null;
    const result = await getDb().transaction(async (tx) => {
      const lock = createHash("sha256").update(`${scope.organizationId}:${idempotencyKey}`).digest("hex");
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`);
      const [existing] = await tx.select({ id: publicEnquiries.id, enquiryNumber: publicEnquiries.enquiryNumber, requestFingerprint: publicEnquiries.requestFingerprint }).from(publicEnquiries).where(and(eq(publicEnquiries.organizationId, scope.organizationId), eq(publicEnquiries.idempotencyKey, idempotencyKey))).limit(1);
      if (existing) {
        if (!verifyPublicEnquiryFingerprint(requestForFingerprint, existing.requestFingerprint, requestContext)) throw new Error("idempotency_conflict");
        return existing;
      }
      // Serialize quota checks by purpose-specific blind index, not plaintext
      // contact data. This keeps concurrent submissions from racing past the
      // limit and avoids trusting caller-supplied forwarding headers for IPs.
      const contactLocks = [
        phoneBlindIndex ? `${scope.organizationId}:public-enquiry:phone:${phoneBlindIndex}` : null,
        emailBlindIndex ? `${scope.organizationId}:public-enquiry:email:${emailBlindIndex}` : null,
      ].filter((value): value is string => value !== null).sort();
      for (const value of contactLocks) {
        const contactLock = createHash("sha256").update(value).digest("hex");
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${contactLock}, 0))`);
      }
      const contactMatches = [
        phoneBlindIndex ? eq(publicEnquiries.phoneBlindIndex, phoneBlindIndex) : undefined,
        emailBlindIndex ? eq(publicEnquiries.emailBlindIndex, emailBlindIndex) : undefined,
      ].filter((value): value is NonNullable<typeof value> => value !== undefined);
      const cutoff = new Date(Date.now() - PUBLIC_CONTACT_SUBMISSION_WINDOW_MS);
      const recent = await tx.select({ id: publicEnquiries.id }).from(publicEnquiries)
        .where(and(eq(publicEnquiries.organizationId, scope.organizationId), gte(publicEnquiries.createdAt, cutoff), or(...contactMatches)))
        .limit(PUBLIC_CONTACT_SUBMISSION_LIMIT);
      if (recent.length >= PUBLIC_CONTACT_SUBMISSION_LIMIT) throw new Error("enquiry_rate_limited");
      const id = randomUUID();
      const context = publicEnquiryContext({ organizationId: scope.organizationId, centreId: parsed.data.centreId, id });
      const ciphertext = encryptLeadValue("private-data", payload, context);
      const [created] = await tx.insert(publicEnquiries).values({
        id, organizationId: scope.organizationId, centreId: parsed.data.centreId,
        enquiryNumber: `RHC-W-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`,
        privateDataCiphertext: ciphertext,
        phoneBlindIndex,
        emailBlindIndex,
        idempotencyKey, requestFingerprint: fingerprint,
      }).returning({ id: publicEnquiries.id, enquiryNumber: publicEnquiries.enquiryNumber, requestFingerprint: publicEnquiries.requestFingerprint });
      const eventId = randomUUID();
      await tx.insert(publicEnquiryEvents).values({ id: eventId, organizationId: scope.organizationId, centreId: parsed.data.centreId, enquiryId: id, eventType: "SUBMITTED", privateDataCiphertext: encryptLeadValue("activity", { category: payload.category, requestTopic: payload.requestTopic }, { organizationId: scope.organizationId, centreId: parsed.data.centreId, recordId: eventId }) });
      return created;
    });
    return Response.json({ accepted: true, reference: result.enquiryNumber }, { status: 202 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return Response.json({ error: code === "idempotency_conflict" ? code : code === "enquiry_rate_limited" ? code : "enquiry_unavailable" }, { status: code === "idempotency_conflict" ? 409 : code === "enquiry_rate_limited" ? 429 : 503 });
  }
}

export async function GET(request: Request) {
  const parsed = reviewQuery.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const access = await getApiAccess("leads.read", parsed.data.centreId);
  if (access.response) return access.response;
  if (parsed.data.summary === "true") {
    const rows = await getDb().select({ id: publicEnquiries.id, reference: publicEnquiries.enquiryNumber, status: publicEnquiries.status, centreId: publicEnquiries.centreId, createdAt: publicEnquiries.createdAt })
      .from(publicEnquiries).where(and(eq(publicEnquiries.organizationId, access.staff.organizationId), eq(publicEnquiries.centreId, parsed.data.centreId), eq(publicEnquiries.status, parsed.data.status)))
      .orderBy(desc(publicEnquiries.createdAt), asc(publicEnquiries.id)).limit(26).offset((parsed.data.page - 1) * 25);
    return Response.json({ enquiries: rows.slice(0, 25), page: parsed.data.page, pageSize: 25, hasMore: rows.length > 25 }, { headers: { "Cache-Control": "private, no-store" } });
  }
  const rows = await getDb().select().from(publicEnquiries).where(and(eq(publicEnquiries.organizationId, access.staff.organizationId), eq(publicEnquiries.centreId, parsed.data.centreId), eq(publicEnquiries.status, parsed.data.status))).orderBy(desc(publicEnquiries.createdAt), asc(publicEnquiries.id)).limit(51).offset((parsed.data.page - 1) * 50);
  try {
    const pageRows = rows.slice(0, 50);
    return Response.json({ enquiries: pageRows.map((row) => {
      const data = decryptLeadValue<PublicEnquiryPayload>("private-data", row.privateDataCiphertext, publicEnquiryContext({ organizationId: row.organizationId, centreId: row.centreId, id: row.id }));
      return { id: row.id, reference: row.enquiryNumber, status: row.status, version: row.versionNumber, centreId: row.centreId, createdAt: row.createdAt, resultingLeadId: row.resultingLeadId, ...data };
    }), page: parsed.data.page, pageSize: 50, hasMore: rows.length > 50 }, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ error: "enquiry_data_unavailable" }, { status: 503 }); }
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const parsedBody = await request.json().catch(() => null);
  const id = z.uuid().safeParse((parsedBody as { id?: unknown } | null)?.id);
  const action = publicEnquiryReviewSchema.safeParse((parsedBody as { action?: unknown } | null) ? Object.fromEntries(Object.entries(parsedBody as object).filter(([key]) => key !== "id")) : null);
  if (!id.success || !action.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const baseAccess = await getApiAccess("leads.read");
  if (baseAccess.response) return baseAccess.response;
  const [initial] = await getDb().select().from(publicEnquiries).where(and(eq(publicEnquiries.id, id.data), eq(publicEnquiries.organizationId, baseAccess.staff.organizationId))).limit(1);
  if (!initial) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("leads.read", initial.centreId);
  if (access.response) return Response.json({ error: "not_found" }, { status: 404 });
  if (action.data.action === "DISMISS") {
    const updateAccess = await getApiAccess("leads.update", initial.centreId);
    if (updateAccess.response) return updateAccess.response;
  }
  if (action.data.action === "CONVERT_TO_LEAD") {
    const createAccess = await getApiAccess("leads.create", initial.centreId);
    if (createAccess.response) return createAccess.response;
    if (action.data.assignedStaffId !== access.staff.staffUserId) {
      const assignAccess = await getApiAccess("leads.assign", initial.centreId);
      if (assignAccess.response || !hasLeadCentrePermission(access.staff.grants, "leads.assign", initial.centreId) || !await isAssignableStaff(getDb(), action.data.assignedStaffId, access.staff.organizationId, initial.centreId)) return Response.json({ error: "invalid_assignee" }, { status: 403 });
    }
  }
  if (action.data.action === "CONVERT_TO_RELATIONSHIP") {
    const initialContext = publicEnquiryContext({ organizationId: initial.organizationId, centreId: initial.centreId, id: initial.id });
    let initialPayload: PublicEnquiryPayload;
    try { initialPayload = decryptLeadValue<PublicEnquiryPayload>("private-data", initial.privateDataCiphertext, initialContext); }
    catch { return Response.json({ error: "enquiry_data_unavailable" }, { status: 503 }); }
    const permission: "corporate.manage" | "partners.manage" = initialPayload.requestTopic === "CORPORATE" ? "corporate.manage" : "partners.manage";
    if (!(["CORPORATE", "PARTNER"] as string[]).includes(initialPayload.requestTopic)) return Response.json({ error: "relationship_conversion_not_available" }, { status: 400 });
    if (!initialPayload.responsePermission || !initialPayload.organizationName?.trim()) return Response.json({ error: "organization_and_response_request_required" }, { status: 400 });
    const updateAccess = await getApiAccess("leads.update", initial.centreId);
    if (updateAccess.response) return updateAccess.response;
    const relationshipAccess = await getApiAccess(permission, initial.centreId);
    if (relationshipAccess.response) return relationshipAccess.response;
  }
  let reviewStage = "transaction_start";
  try {
    const outcome = await getDb().transaction(async (tx) => {
      reviewStage = "lock_enquiry";
      const [row] = await tx.select().from(publicEnquiries).where(and(eq(publicEnquiries.id, id.data), eq(publicEnquiries.organizationId, access.staff.organizationId), eq(publicEnquiries.centreId, initial.centreId))).for("update").limit(1);
      if (!row || row.status !== "PENDING_REVIEW" || row.versionNumber !== action.data.expectedVersion) throw new Error("state_conflict");
      reviewStage = "decrypt_enquiry";
      const context = publicEnquiryContext({ organizationId: row.organizationId, centreId: row.centreId, id: row.id });
      const payload = decryptLeadValue<PublicEnquiryPayload>("private-data", row.privateDataCiphertext, context);
      if (action.data.action === "CONVERT_TO_LEAD" && payload.category === "SUPPORT") throw new Error("support_enquiry_requires_support_task");
      const eventId = randomUUID();
      if (action.data.action === "DISMISS") {
        const dismissedPayload = encryptLeadValue("activity", { reason: action.data.reason }, { organizationId: row.organizationId, centreId: row.centreId, recordId: eventId });
        await tx.update(publicEnquiries).set({ status: "DISMISSED", reviewedByStaffId: access.staff.staffUserId, reviewedAt: new Date(), versionNumber: row.versionNumber + 1 }).where(eq(publicEnquiries.id, row.id));
        await tx.insert(publicEnquiryEvents).values({ id: eventId, organizationId: row.organizationId, centreId: row.centreId, enquiryId: row.id, eventType: "DISMISSED", privateDataCiphertext: dismissedPayload, actorStaffId: access.staff.staffUserId });
        await appendAuditEvent(tx, { organizationId: row.organizationId, centreId: row.centreId, actorStaffId: access.staff.staffUserId, action: "public_enquiry.dismissed", entityType: "public_enquiry", entityId: row.id, details: { status: "DISMISSED" } });
        return { status: "DISMISSED" as const };
      }
      if (action.data.action === "CONVERT_TO_RELATIONSHIP") {
        reviewStage = "validate_relationship_conversion";
        const relationshipType: BusinessRelationshipType = payload.requestTopic === "CORPORATE" ? "CORPORATE" : "PARTNER";
        if (!(["CORPORATE", "PARTNER"] as string[]).includes(payload.requestTopic) || !payload.responsePermission || !payload.organizationName?.trim()) throw new Error("relationship_conversion_not_available");
        const relationshipId = randomUUID();
        const relationshipNumber = `RHC-${relationshipType === "CORPORATE" ? "C" : "P"}-${new Date().getFullYear()}-${relationshipId.slice(0, 8).toUpperCase()}`;
        const relationshipPrivate: BusinessRelationshipPrivateData = {
          name: payload.organizationName.trim(), legalName: null, primaryContactName: `${payload.firstName} ${payload.lastName}`.trim(),
          primaryContactRole: "Enquiry contact; identity and authority unverified", phone: payload.phone, email: payload.email, address: null,
          // Free-text enquiry content can contain patient/clinical information.
          // Keep it in the encrypted enquiry record's narrower review scope; do not
          // copy it into the broader business-relationship profile.
          agreementReference: null, agreementStatus: "NOT_RECORDED", notes: null,
        };
        reviewStage = "encrypt_relationship_profile";
        const relationshipCipher = sealBusinessRelationship({ organizationId: row.organizationId, centreId: row.centreId, id: relationshipId }, relationshipType, relationshipPrivate);
        reviewStage = "insert_relationship_profile";
        const [relationship] = (await tx.execute(sql`INSERT INTO business_relationships(id,organization_id,centre_id,relationship_type,relationship_number,category,status,private_data_ciphertext,created_by_staff_id,updated_by_staff_id,source_public_enquiry_id) VALUES(${relationshipId},${row.organizationId},${row.centreId},${relationshipType},${relationshipNumber},'ENQUIRY_PENDING','INACTIVE',${relationshipCipher},${access.staff.staffUserId},${access.staff.staffUserId},${row.id}) RETURNING id,relationship_number`)).rows as Array<{ id: string; relationship_number: string }>;
        const relationshipEventId = randomUUID();
        reviewStage = "encrypt_relationship_history";
        const relationshipEventCipher = sealBusinessRelationshipEvent({ organizationId: row.organizationId, centreId: row.centreId, id: relationshipEventId }, relationshipType, { source: "PUBLIC_ENQUIRY", enquiryNumber: row.enquiryNumber, status: "INACTIVE", agreementStatus: "NOT_RECORDED" });
        reviewStage = "insert_relationship_history";
        await tx.execute(sql`INSERT INTO business_relationship_events(id,organization_id,centre_id,relationship_id,relationship_type,event_type,private_data_ciphertext,actor_staff_id) VALUES(${relationshipEventId},${row.organizationId},${row.centreId},${relationship.id},${relationshipType},'CREATED',${relationshipEventCipher},${access.staff.staffUserId})`);
        await tx.update(publicEnquiries).set({ status: "CONVERTED_TO_RELATIONSHIP", reviewedByStaffId: access.staff.staffUserId, reviewedAt: new Date(), versionNumber: row.versionNumber + 1 }).where(eq(publicEnquiries.id, row.id));
        reviewStage = "insert_enquiry_history";
        await tx.insert(publicEnquiryEvents).values({ id: eventId, organizationId: row.organizationId, centreId: row.centreId, enquiryId: row.id, eventType: "CONVERTED_TO_RELATIONSHIP", privateDataCiphertext: encryptLeadValue("activity", { relationshipId: relationship.id, relationshipNumber: relationship.relationship_number }, { organizationId: row.organizationId, centreId: row.centreId, recordId: eventId }), actorStaffId: access.staff.staffUserId });
        await appendAuditEvent(tx, { organizationId: row.organizationId, centreId: row.centreId, actorStaffId: access.staff.staffUserId, action: "public_enquiry.converted_to_relationship", entityType: "business_relationship", entityId: relationship.id, details: { relationshipType, status: "INACTIVE", agreementStatus: "NOT_RECORDED" } });
        return { status: "CONVERTED_TO_RELATIONSHIP" as const, relationshipId: relationship.id, relationshipNumber: relationship.relationship_number, relationshipType, active: false };
      }
      const phone = payload.phone, email = payload.email;
      const phoneIndex = phone ? blindIndexLeadContact("phone", phone) : null;
      const emailIndex = email ? blindIndexLeadContact("email", email) : null;
      const identityLock = createHash("sha256").update(`${row.organizationId}:${row.centreId}:${phoneIndex ?? ""}:${emailIndex ?? ""}`).digest("hex");
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${identityLock}, 0))`);
      const duplicate = await tx.select({ id: leadPrivateData.leadId }).from(leadPrivateData).where(and(eq(leadPrivateData.organizationId, row.organizationId), eq(leadPrivateData.centreId, row.centreId), sql`(${phoneIndex ? sql`${leadPrivateData.phoneBlindIndex} = ${phoneIndex}` : sql`false`} OR ${emailIndex ? sql`${leadPrivateData.emailBlindIndex} = ${emailIndex}` : sql`false`})`)).limit(1);
      if (duplicate.length) throw new Error("possible_duplicate_review_required");
      let marketingCampaignId: string | null = null;
      const campaignCode = payload.campaignAttribution?.campaign;
      if (campaignCode) {
        const [campaign] = await tx.select({ id: marketingCampaigns.id }).from(marketingCampaigns)
          .where(and(eq(marketingCampaigns.organizationId, row.organizationId), eq(marketingCampaigns.centreId, row.centreId), eq(marketingCampaigns.status, "ACTIVE"), sql`lower(${marketingCampaigns.campaignCode}) = ${campaignCode}`)).limit(1);
        marketingCampaignId = campaign?.id ?? null;
      }
      const leadId = randomUUID();
      const leadNumber = `RHC-L-${new Date().getFullYear()}-${leadId.slice(0, 8).toUpperCase()}`;
      const [lead] = await tx.insert(leads).values({
        id: leadId, organizationId: row.organizationId, centreId: row.centreId, leadNumber,
        enquiryCategory: payload.category === "SUPPORT" ? "OTHER" : payload.category, homeCollectionInterest: payload.category === "HOME_COLLECTION", source: "WEBSITE", status: "NEW", priority: "NORMAL",
        assignedStaffId: action.data.assignedStaffId, preferredChannel: phone ? "PHONE" : "EMAIL",
        contactPermission: "PENDING", contactPermissionRecordedBy: null, contactPermissionRecordedAt: null,
        marketingCampaignId,
        createdByStaffId: access.staff.staffUserId,
      }).returning({ id: leads.id, leadNumber: leads.leadNumber });
      const privateLead: LeadPrivateData = { firstName: payload.firstName, lastName: payload.lastName, phone, email, interestedService: payload.requestedService, campaign: formatPublicCampaignAttribution(payload.campaignAttribution), contactEvidenceReference: null, marketingEvidenceReference: null, lostReason: null };
      await saveLeadPrivateData(tx, { organizationId: row.organizationId, centreId: row.centreId, recordId: leadId }, privateLead);
      await addLeadActivity(tx, { organizationId: row.organizationId, centreId: row.centreId, leadId, actorStaffId: access.staff.staffUserId, activityType: "NOTE", body: payload.message, metadata: { source: "PUBLIC_ENQUIRY", requestTopic: payload.requestTopic, enquiryCategory: payload.category, organizationName: payload.organizationName ?? null, requestKind: payload.requestKind, requestedService: payload.requestedService, requestedCatalogueItemId: payload.requestedCatalogueItemId ?? null, requestedCatalogueVersion: payload.requestedCatalogueVersion ?? null, preferredDate: payload.preferredDate, preferredTimeWindow: payload.preferredTimeWindow, visitType: payload.visitType, collectionAddress: payload.collectionAddress, responsePermission: payload.responsePermission, responsePermissionTextVersion: payload.responsePermissionTextVersion, submittedAt: payload.submittedAt } });
      await tx.update(publicEnquiries).set({ status: "CONVERTED_TO_LEAD", reviewedByStaffId: access.staff.staffUserId, reviewedAt: new Date(), resultingLeadId: lead.id, versionNumber: row.versionNumber + 1 }).where(eq(publicEnquiries.id, row.id));
      await tx.insert(publicEnquiryEvents).values({ id: eventId, organizationId: row.organizationId, centreId: row.centreId, enquiryId: row.id, eventType: "CONVERTED_TO_LEAD", privateDataCiphertext: encryptLeadValue("activity", { leadId: lead.id }, { organizationId: row.organizationId, centreId: row.centreId, recordId: eventId }), actorStaffId: access.staff.staffUserId });
      await appendAuditEvent(tx, { organizationId: row.organizationId, centreId: row.centreId, actorStaffId: access.staff.staffUserId, action: "public_enquiry.converted_to_lead", entityType: "lead", entityId: lead.id, details: { source: "WEBSITE", status: "NEW" } });
      return { status: "CONVERTED_TO_LEAD" as const, leadId: lead.id, leadNumber: lead.leadNumber };
    });
    return Response.json(outcome);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const postgresError = error && typeof error === "object" ? error as { code?: unknown; constraint?: unknown } : {};
    const cause = error instanceof Error && error.cause && typeof error.cause === "object" ? error.cause as { name?: unknown; code?: unknown; constraint?: unknown } : {};
    console.error("public_enquiry_review_persistence_failed", { stage: reviewStage, errorType: error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : typeof error === "string" && /^[a-z_]{1,50}$/.test(error) ? error : "UnknownError", errorCode: message && /^[a-z_]{1,60}$/.test(message) ? message : undefined, postgresCode: typeof postgresError.code === "string" && /^[A-Z0-9]{5}$/.test(postgresError.code) ? postgresError.code : undefined, constraint: typeof postgresError.constraint === "string" && /^[a-z0-9_]{1,80}$/.test(postgresError.constraint) ? postgresError.constraint : undefined, causeType: typeof cause.name === "string" && /^[A-Za-z]{1,40}$/.test(cause.name) ? cause.name : undefined, causeCode: typeof cause.code === "string" && /^[A-Z0-9]{5}$/.test(cause.code) ? cause.code : undefined, causeConstraint: typeof cause.constraint === "string" && /^[a-z0-9_]{1,80}$/.test(cause.constraint) ? cause.constraint : undefined });
    const known = ["state_conflict", "invalid_assignee", "possible_duplicate_review_required", "relationship_conversion_not_available", "support_enquiry_requires_support_task"];
    return Response.json({ error: known.includes(message) ? message : "review_unavailable" }, { status: message === "invalid_assignee" ? 403 : known.includes(message) ? 409 : 503 });
  }
}
