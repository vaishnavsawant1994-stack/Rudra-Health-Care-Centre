import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appendAuditEvent } from "@/server/audit";
import { appointments, centres, diagnosticCatalogueItems, diagnosticCatalogueVersions, diagnosticOrderItems, diagnosticOrders, diagnosticOrderStatusHistory, diagnosticPackageComponents, patients } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { visibleLeadCentres } from "@/server/lead-policy";
import { effectiveVerifiedPrice, hasOverlappingServices, orderCreateSchema } from "@/server/order-policy";

const listSchema = z.object({ centreId: z.uuid().optional(), status: z.enum(["DRAFT", "PENDING_VERIFICATION", "CONFIRMED", "CANCELLED"]).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) });

export async function GET(request: Request) {
  const parsed = listSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const access = await getApiAccess("orders.read");
  if (access.response) return access.response;
  const scopes = visibleLeadCentres(access.staff.grants, "orders.read");
  if (scopes && parsed.data.centreId && !scopes.includes(parsed.data.centreId)) return Response.json({ error: "forbidden" }, { status: 403 });
  const scopeFilters = [eq(diagnosticOrders.organizationId, access.staff.organizationId)];
  if (parsed.data.centreId) scopeFilters.push(eq(diagnosticOrders.centreId, parsed.data.centreId));
  else if (scopes) scopeFilters.push(inArray(diagnosticOrders.centreId, scopes));
  const filters = [...scopeFilters];
  if (parsed.data.status) filters.push(eq(diagnosticOrders.status, parsed.data.status));
  const rows = await getDb().select({ id: diagnosticOrders.id, orderNumber: diagnosticOrders.orderNumber, centreId: diagnosticOrders.centreId, appointmentId: diagnosticOrders.appointmentId, status: diagnosticOrders.status, versionNumber: diagnosticOrders.versionNumber, totalAmount: diagnosticOrders.totalAmount, createdAt: diagnosticOrders.createdAt, itemCount: sql<number>`count(${diagnosticOrderItems.id})::int` })
    .from(diagnosticOrders).leftJoin(diagnosticOrderItems, and(eq(diagnosticOrderItems.orderId, diagnosticOrders.id), eq(diagnosticOrderItems.organizationId, diagnosticOrders.organizationId), eq(diagnosticOrderItems.centreId, diagnosticOrders.centreId), isNull(diagnosticOrderItems.removedAt))).where(and(...filters)).groupBy(diagnosticOrders.id).orderBy(desc(diagnosticOrders.createdAt)).limit(parsed.data.limit);
  const grouped = await getDb().select({ status: diagnosticOrders.status, value: count() }).from(diagnosticOrders).where(and(...scopeFilters)).groupBy(diagnosticOrders.status);
  const summary = Object.fromEntries(["DRAFT", "PENDING_VERIFICATION", "CONFIRMED", "CANCELLED"].map((state) => [state, grouped.find((row) => row.status === state)?.value ?? 0]));
  return Response.json({ orders: rows, summary });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const key = request.headers.get("idempotency-key");
  if (!z.uuid().safeParse(key).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const parsed = orderCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const access = await getApiAccess("orders.create", parsed.data.centreId);
  if (access.response) return access.response;
  const patientAccess = await getApiAccess("patients.read", parsed.data.centreId);
  if (patientAccess.response) return patientAccess.response;
  if (parsed.data.appointmentId) {
    const apptAccess = await getApiAccess("appointments.read", parsed.data.centreId);
    if (apptAccess.response) return apptAccess.response;
  }
  const db = getDb(); const { staff } = access; const data = parsed.data;
  const requestHash = createHash("sha256").update(JSON.stringify(data)).digest("hex");
  try {
    const result = await db.transaction(async (tx) => {
      const lock = `${staff.organizationId}:diagnostic-order:${key}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`);
      const [existing] = await tx.select({ id: diagnosticOrders.id, orderNumber: diagnosticOrders.orderNumber, status: diagnosticOrders.status, requestHash: diagnosticOrders.requestHash }).from(diagnosticOrders).where(and(eq(diagnosticOrders.organizationId, staff.organizationId), eq(diagnosticOrders.idempotencyKey, key!))).limit(1);
      if (existing) { if (existing.requestHash !== requestHash) throw new Error("idempotency_conflict"); return { ...existing, replayed: true }; }
      const [centre] = await tx.select({ id: centres.id }).from(centres).where(and(eq(centres.id, data.centreId), eq(centres.organizationId, staff.organizationId), eq(centres.status, "ACTIVE"))).limit(1);
      if (!centre) throw new Error("centre_not_found");
      let patientId = data.patientId;
      if (data.appointmentId) {
        const [appointment] = await tx.select({ patientId: appointments.patientId, status: appointments.status }).from(appointments).where(and(eq(appointments.id, data.appointmentId), eq(appointments.organizationId, staff.organizationId), eq(appointments.centreId, data.centreId))).limit(1);
        if (!appointment || ["CANCELLED", "NO_SHOW"].includes(appointment.status)) throw new Error("appointment_not_available");
        if (patientId && patientId !== appointment.patientId) throw new Error("appointment_patient_mismatch");
        patientId = appointment.patientId;
      }
      if (!patientId) throw new Error("patient_required");
      const [patient] = await tx.select({ id: patients.id }).from(patients).where(and(eq(patients.id, patientId), eq(patients.organizationId, staff.organizationId), eq(patients.centreId, data.centreId))).limit(1);
      if (!patient) throw new Error("patient_not_found");
      const versions = await tx.select({ itemId: diagnosticCatalogueItems.id, itemType: diagnosticCatalogueItems.serviceType, serviceCode: diagnosticCatalogueItems.serviceCode, active: diagnosticCatalogueItems.active, currentVersion: diagnosticCatalogueItems.currentVersion, versionId: diagnosticCatalogueVersions.id, versionNumber: diagnosticCatalogueVersions.versionNumber, displayName: diagnosticCatalogueVersions.displayName, specimenRequirements: diagnosticCatalogueVersions.specimenRequirements, preparationInstructions: diagnosticCatalogueVersions.preparationInstructions, metropolisReferenceCode: diagnosticCatalogueVersions.metropolisReferenceCode, verificationStatus: diagnosticCatalogueVersions.verificationStatus, priceAmount: diagnosticCatalogueVersions.priceAmount, currency: diagnosticCatalogueVersions.currency, priceSourceReference: diagnosticCatalogueVersions.priceSourceReference, effectiveFrom: diagnosticCatalogueVersions.effectiveFrom, effectiveUntil: diagnosticCatalogueVersions.effectiveUntil })
        .from(diagnosticCatalogueVersions).innerJoin(diagnosticCatalogueItems, and(eq(diagnosticCatalogueItems.id, diagnosticCatalogueVersions.catalogueItemId), eq(diagnosticCatalogueItems.organizationId, diagnosticCatalogueVersions.organizationId), eq(diagnosticCatalogueItems.centreId, diagnosticCatalogueVersions.centreId), eq(diagnosticCatalogueItems.currentVersion, diagnosticCatalogueVersions.versionNumber))).where(and(eq(diagnosticCatalogueVersions.organizationId, staff.organizationId), eq(diagnosticCatalogueVersions.centreId, data.centreId), inArray(diagnosticCatalogueVersions.id, data.catalogueVersionIds), eq(diagnosticCatalogueItems.active, true))).orderBy(asc(diagnosticCatalogueItems.serviceCode));
      if (versions.length !== data.catalogueVersionIds.length) throw new Error("catalogue_selection_not_current");
      const componentRows = versions.filter((item) => item.itemType === "PACKAGE").length ? await tx.select({ packageVersionId: diagnosticPackageComponents.packageVersionId, code: diagnosticCatalogueItems.serviceCode, name: diagnosticCatalogueVersions.displayName, version: diagnosticCatalogueVersions.versionNumber, verificationStatus: diagnosticCatalogueVersions.verificationStatus }).from(diagnosticPackageComponents).innerJoin(diagnosticCatalogueVersions, eq(diagnosticCatalogueVersions.id, diagnosticPackageComponents.testVersionId)).innerJoin(diagnosticCatalogueItems, eq(diagnosticCatalogueItems.id, diagnosticCatalogueVersions.catalogueItemId)).where(and(eq(diagnosticPackageComponents.organizationId, staff.organizationId), eq(diagnosticPackageComponents.centreId, data.centreId), inArray(diagnosticPackageComponents.packageVersionId, versions.filter((item) => item.itemType === "PACKAGE").map((item) => item.versionId)))) : [];
      const components = new Map<string, typeof componentRows>();
      for (const component of componentRows) components.set(component.packageVersionId, [...(components.get(component.packageVersionId) ?? []), component]);
      const duplicateOverlap = hasOverlappingServices(versions.map((item) => ({ serviceType: item.itemType, serviceCode: item.serviceCode, components: (components.get(item.versionId) ?? []).map((component) => component.code) })));
      if (duplicateOverlap) throw new Error("overlapping_diagnostic_services");
      const snapshots = versions.map((item) => {
        const priceIsVerified = item.active && item.versionNumber === item.currentVersion && effectiveVerifiedPrice(item);
        return { item, priceIsVerified, serviceSnapshot: { specimenRequirements: item.specimenRequirements, preparationInstructions: item.preparationInstructions, metropolisReferenceCode: item.metropolisReferenceCode, catalogueVersion: item.versionNumber, packageComponents: components.get(item.versionId) ?? [] } };
      });
      const status = snapshots.every((snapshot) => snapshot.priceIsVerified) ? "DRAFT" : "PENDING_VERIFICATION";
      const id = randomUUID();
      const [order] = await tx.insert(diagnosticOrders).values({ id, organizationId: staff.organizationId, centreId: data.centreId, orderNumber: `RHC-O-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`, patientId, appointmentId: data.appointmentId ?? null, status, idempotencyKey: key!, requestHash, createdByStaffId: staff.staffUserId }).returning({ id: diagnosticOrders.id, orderNumber: diagnosticOrders.orderNumber, status: diagnosticOrders.status, versionNumber: diagnosticOrders.versionNumber });
      await tx.insert(diagnosticOrderItems).values(snapshots.map(({ item, priceIsVerified, serviceSnapshot }) => ({ organizationId: staff.organizationId, centreId: data.centreId, orderId: id, catalogueItemId: item.itemId, catalogueVersionId: item.versionId, serviceType: item.itemType, serviceCode: item.serviceCode, displayName: item.displayName, verificationStatus: priceIsVerified ? "VERIFIED" : item.verificationStatus === "VERIFIED" ? "UNVERIFIED" : item.verificationStatus, priceAmount: priceIsVerified ? item.priceAmount : null, priceSourceReference: priceIsVerified ? item.priceSourceReference : null, effectiveFrom: priceIsVerified ? item.effectiveFrom : null, effectiveUntil: priceIsVerified ? item.effectiveUntil : null, serviceSnapshot })));
      await tx.insert(diagnosticOrderStatusHistory).values({ organizationId: staff.organizationId, centreId: data.centreId, orderId: id, fromStatus: null, toStatus: status, reason: "Order draft created", versionNumber: order.versionNumber, actorStaffId: staff.staffUserId });
      await appendAuditEvent(tx, { organizationId: staff.organizationId, centreId: data.centreId, actorStaffId: staff.staffUserId, action: "diagnostic_order.created", entityType: "diagnostic_order", entityId: id, details: { itemCount: snapshots.length, status, appointmentLinked: Boolean(data.appointmentId) } });
      return { ...order, replayed: false };
    });
    return Response.json({ order: result }, { status: result.replayed ? 200 : 201 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const known = new Set(["idempotency_conflict", "centre_not_found", "appointment_not_available", "appointment_patient_mismatch", "patient_required", "patient_not_found", "catalogue_selection_not_current", "overlapping_diagnostic_services"]);
    if (known.has(code)) return Response.json({ error: code }, { status: code === "idempotency_conflict" ? 409 : 400 });
    return Response.json({ error: "order_creation_conflict_or_unavailable" }, { status: 409 });
  }
}
