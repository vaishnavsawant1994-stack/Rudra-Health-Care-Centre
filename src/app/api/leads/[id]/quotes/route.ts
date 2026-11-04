import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { getDb } from "@/db/client";
import { centres, diagnosticCatalogueItems, diagnosticCatalogueVersions, diagnosticPackageComponents, leadQuotes, leads } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { decryptOperationalData, encryptOperationalData, fingerprintOperationalRequest, operationalContext, verifyOperationalRequestFingerprint } from "@/server/operational-crypto";
import { hasPermission } from "@/server/permissions";
import { buildInternalQuoteTotal, cataloguePriceToPaise, leadQuoteCreateSchema, localDateForTimeZone, quoteableVerifiedPrice, quoteSelectionHasOverlap } from "@/server/lead-quote-policy";

const uuid = z.uuid();
type QuoteSnapshot = { currency: "INR"; lines: Array<{ catalogueItemId: string; catalogueVersionId: string; serviceType: string; serviceCode: string; displayName: string; versionNumber: number; pricePaise: number; currency: "INR"; sourceReference: string; effectiveFrom: string; effectiveUntil: string | null }>; promotion: "NOT_APPLIED_POLICY_NOT_CONFIGURED"; visitType: "CENTRE" | "HOME_COLLECTION"; homeVisitFeePaise: number; homeVisitFeeReason: string | null; diagnosticTotalPaise: number; totalPaise: number };
const quoteContext = (organizationId: string, centreId: string, id: string) => operationalContext({ organizationId, centreId, recordId: id }, "lead-price-quote");

async function accessibleLead(id: string) {
  const access = await getApiAccess("leads.read");
  if (access.response) return { response: access.response } as const;
  const [lead] = await getDb().select({ id: leads.id, organizationId: leads.organizationId, centreId: leads.centreId, leadNumber: leads.leadNumber }).from(leads).where(and(eq(leads.id, id), eq(leads.organizationId, access.staff.organizationId))).limit(1);
  if (!lead || !hasPermission(access.staff.grants, "leads.read", lead.centreId)) return { response: Response.json({ error: "not_found" }, { status: 404 }) } as const;
  if (!hasPermission(access.staff.grants, "finance.read", lead.centreId)) return { response: Response.json({ error: "forbidden" }, { status: 403 }) } as const;
  return { lead, staff: access.staff } as const;
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!uuid.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const scope = await accessibleLead(id); if (scope.response) return scope.response;
  const rows = await getDb().select().from(leadQuotes).where(and(eq(leadQuotes.organizationId, scope.lead.organizationId), eq(leadQuotes.centreId, scope.lead.centreId), eq(leadQuotes.leadId, id))).orderBy(desc(leadQuotes.versionNumber)).limit(50);
  try {
    const quotes = rows.map((row) => { const snapshot = decryptOperationalData<QuoteSnapshot>(row.privateSnapshotCiphertext, quoteContext(row.organizationId, row.centreId, row.id)); return { id: row.id, quoteNumber: row.quoteNumber, versionNumber: row.versionNumber, status: row.status, currency: snapshot.currency, diagnosticTotalPaise: snapshot.diagnosticTotalPaise, homeVisitFeePaise: snapshot.homeVisitFeePaise, totalPaise: snapshot.totalPaise, snapshot, createdAt: row.createdAt, createdByStaffId: row.createdByStaffId }; });
    return Response.json({ quotes, delivery: "DISABLED", quoteUse: "INTERNAL_DRAFT_ONLY" }, { headers: { "cache-control": "private, no-store" } });
  } catch { return Response.json({ error: "quote_data_unavailable" }, { status: 503, headers: { "cache-control": "private, no-store" } }); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  if (Number(request.headers.get("content-length") ?? 0) > 16_384) return Response.json({ error: "invalid_input" }, { status: 413 });
  const { id } = await context.params;
  if (!uuid.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!uuid.safeParse(idempotencyKey).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const parsed = leadQuoteCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_quote_selection", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const scope = await accessibleLead(id);
  if (scope.response) return scope.response;
  if (!hasPermission(scope.staff.grants, "catalogue.read", scope.lead.centreId) || !hasPermission(scope.staff.grants, "orders.create", scope.lead.centreId)) return Response.json({ error: "forbidden" }, { status: 403 });

  const data = parsed.data;
  const requestValue = { leadId: id, catalogueVersionIds: [...data.catalogueVersionIds].sort(), visitType: data.visitType, homeVisitFeePaise: data.homeVisitFeePaise, homeVisitFeeReason: data.homeVisitFeeReason?.trim() || null };
  const requestContext = operationalContext({ organizationId: scope.lead.organizationId, centreId: scope.lead.centreId, recordId: idempotencyKey! }, "lead-quote-idempotency");
  let requestFingerprint: string;
  try { requestFingerprint = fingerprintOperationalRequest(requestValue, requestContext); }
  catch { return Response.json({ error: "quote_service_unavailable" }, { status: 503 }); }

  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${scope.lead.organizationId}:lead-quote:${idempotencyKey}`},0))`);
      const [replay] = await tx.select().from(leadQuotes).where(and(eq(leadQuotes.organizationId, scope.lead.organizationId), eq(leadQuotes.idempotencyKey, idempotencyKey!))).limit(1);
      if (replay) {
        if (replay.leadId !== id || replay.createdByStaffId !== scope.staff.staffUserId || !verifyOperationalRequestFingerprint(requestValue, replay.requestFingerprint, requestContext)) throw new Error("idempotency_conflict");
        return { row: replay, replayed: true };
      }
      const [lead] = await tx.select({ id: leads.id, leadNumber: leads.leadNumber, status: leads.status, centreId: leads.centreId }).from(leads).where(and(eq(leads.id, id), eq(leads.organizationId, scope.lead.organizationId), eq(leads.centreId, scope.lead.centreId))).for("update").limit(1);
      if (!lead || ["CONVERTED", "LOST", "DUPLICATE", "DO_NOT_CONTACT"].includes(lead.status)) throw new Error("lead_not_quoteable");
      const [centre] = await tx.select({ timeZone: centres.timeZone }).from(centres).where(and(eq(centres.id, lead.centreId), eq(centres.organizationId, scope.lead.organizationId), eq(centres.status, "ACTIVE"))).limit(1);
      if (!centre) throw new Error("lead_not_quoteable");
      const effectivePriceDate = localDateForTimeZone(new Date(), centre.timeZone);
      const versions = await tx.select({ itemId: diagnosticCatalogueItems.id, itemType: diagnosticCatalogueItems.serviceType, serviceCode: diagnosticCatalogueItems.serviceCode, active: diagnosticCatalogueItems.active, currentVersion: diagnosticCatalogueItems.currentVersion, versionId: diagnosticCatalogueVersions.id, versionNumber: diagnosticCatalogueVersions.versionNumber, displayName: diagnosticCatalogueVersions.displayName, verificationStatus: diagnosticCatalogueVersions.verificationStatus, priceAmount: diagnosticCatalogueVersions.priceAmount, currency: diagnosticCatalogueVersions.currency, priceSourceReference: diagnosticCatalogueVersions.priceSourceReference, effectiveFrom: diagnosticCatalogueVersions.effectiveFrom, effectiveUntil: diagnosticCatalogueVersions.effectiveUntil })
        .from(diagnosticCatalogueVersions).innerJoin(diagnosticCatalogueItems, and(eq(diagnosticCatalogueItems.id, diagnosticCatalogueVersions.catalogueItemId), eq(diagnosticCatalogueItems.organizationId, diagnosticCatalogueVersions.organizationId), eq(diagnosticCatalogueItems.centreId, diagnosticCatalogueVersions.centreId))).where(and(eq(diagnosticCatalogueVersions.organizationId, scope.lead.organizationId), eq(diagnosticCatalogueVersions.centreId, lead.centreId), inArray(diagnosticCatalogueVersions.id, data.catalogueVersionIds), eq(diagnosticCatalogueItems.active, true), eq(diagnosticCatalogueItems.currentVersion, diagnosticCatalogueVersions.versionNumber))).orderBy(asc(diagnosticCatalogueItems.serviceCode));
      if (versions.length !== data.catalogueVersionIds.length || versions.some((row) => !quoteableVerifiedPrice(row, effectivePriceDate))) throw new Error("catalogue_selection_unavailable");
      const packages = versions.filter((row) => row.itemType === "PACKAGE");
      const componentRows = packages.length ? await tx.select({ packageVersionId: diagnosticPackageComponents.packageVersionId, serviceCode: diagnosticCatalogueItems.serviceCode }).from(diagnosticPackageComponents).innerJoin(diagnosticCatalogueVersions, and(eq(diagnosticCatalogueVersions.id, diagnosticPackageComponents.testVersionId), eq(diagnosticCatalogueVersions.organizationId, diagnosticPackageComponents.organizationId), eq(diagnosticCatalogueVersions.centreId, diagnosticPackageComponents.centreId))).innerJoin(diagnosticCatalogueItems, and(eq(diagnosticCatalogueItems.id, diagnosticCatalogueVersions.catalogueItemId), eq(diagnosticCatalogueItems.organizationId, diagnosticCatalogueVersions.organizationId), eq(diagnosticCatalogueItems.centreId, diagnosticCatalogueVersions.centreId))).where(and(eq(diagnosticPackageComponents.organizationId, scope.lead.organizationId), eq(diagnosticPackageComponents.centreId, lead.centreId), inArray(diagnosticPackageComponents.packageVersionId, packages.map((row) => row.versionId)))) : [];
      const overlapServices = versions.map((row) => ({ serviceType: row.itemType, serviceCode: row.serviceCode, components: componentRows.filter((component) => component.packageVersionId === row.versionId).map((component) => component.serviceCode) }));
      if (quoteSelectionHasOverlap(overlapServices)) throw new Error("overlapping_services");
      const prices = versions.map((row) => cataloguePriceToPaise(row.priceAmount));
      const totals = buildInternalQuoteTotal(prices, data.homeVisitFeePaise);
      const [latest] = await tx.select({ versionNumber: leadQuotes.versionNumber }).from(leadQuotes).where(and(eq(leadQuotes.organizationId, scope.lead.organizationId), eq(leadQuotes.centreId, lead.centreId), eq(leadQuotes.leadId, id))).orderBy(desc(leadQuotes.versionNumber)).limit(1);
      const versionNumber = (latest?.versionNumber ?? 0) + 1;
      const quoteId = randomUUID();
      const snapshot: QuoteSnapshot = { currency: "INR", lines: versions.map((row, index) => ({ catalogueItemId: row.itemId, catalogueVersionId: row.versionId, serviceType: row.itemType, serviceCode: row.serviceCode, displayName: row.displayName, versionNumber: row.versionNumber, pricePaise: prices[index], currency: "INR", sourceReference: row.priceSourceReference!, effectiveFrom: row.effectiveFrom!, effectiveUntil: row.effectiveUntil })), promotion: "NOT_APPLIED_POLICY_NOT_CONFIGURED", visitType: data.visitType, homeVisitFeeReason: data.homeVisitFeePaise === 0 ? data.homeVisitFeeReason?.trim() || (data.visitType === "CENTRE" ? "No home-visit service" : null) : null, ...totals };
      const [created] = await tx.insert(leadQuotes).values({ id: quoteId, organizationId: scope.lead.organizationId, centreId: lead.centreId, leadId: id, quoteNumber: `${lead.leadNumber}-Q${versionNumber}`, versionNumber, status: "INTERNAL_DRAFT", privateSnapshotCiphertext: encryptOperationalData(snapshot, quoteContext(scope.lead.organizationId, lead.centreId, quoteId)), createdByStaffId: scope.staff.staffUserId, idempotencyKey: idempotencyKey!, requestFingerprint }).returning();
      await appendAuditEvent(tx, { organizationId: scope.lead.organizationId, centreId: lead.centreId, actorStaffId: scope.staff.staffUserId, action: "lead.quote_draft_created", entityType: "lead_quote", entityId: quoteId, details: { version: versionNumber, homeVisitFeeApplied: data.homeVisitFeePaise > 0, serviceCount: versions.length, status: "INTERNAL_DRAFT" } });
      return { row: created, replayed: false };
    });
    const snapshot = decryptOperationalData<QuoteSnapshot>(result.row.privateSnapshotCiphertext, quoteContext(result.row.organizationId, result.row.centreId, result.row.id));
    return Response.json({ quote: { id: result.row.id, quoteNumber: result.row.quoteNumber, versionNumber: result.row.versionNumber, status: result.row.status, currency: snapshot.currency, diagnosticTotalPaise: snapshot.diagnosticTotalPaise, homeVisitFeePaise: snapshot.homeVisitFeePaise, totalPaise: snapshot.totalPaise, snapshot, createdAt: result.row.createdAt }, replayed: result.replayed, delivery: "DISABLED", quoteUse: "INTERNAL_DRAFT_ONLY" }, { status: result.replayed ? 200 : 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const known: Record<string, number> = { idempotency_conflict: 409, lead_not_quoteable: 409, catalogue_selection_unavailable: 409, overlapping_services: 409 };
    return Response.json({ error: known[code] ? code : "quote_creation_unavailable" }, { status: known[code] ?? 503 });
  }
}
