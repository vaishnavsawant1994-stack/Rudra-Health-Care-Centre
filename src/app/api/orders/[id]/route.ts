import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appendAuditEvent } from "@/server/audit";
import { diagnosticCatalogueItems, diagnosticCatalogueVersions, diagnosticOrderItems, diagnosticOrders, diagnosticOrderStatusHistory, diagnosticPackageComponents } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { effectiveVerifiedPrice, hasOverlappingServices, orderUpdateSchema } from "@/server/order-policy";

const idSchema = z.uuid();

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const base = await getApiAccess("orders.read");
  if (base.response) return base.response;
  const db = getDb();
  const [order] = await db.select({ id: diagnosticOrders.id, organizationId: diagnosticOrders.organizationId, centreId: diagnosticOrders.centreId, orderNumber: diagnosticOrders.orderNumber, appointmentId: diagnosticOrders.appointmentId, status: diagnosticOrders.status, versionNumber: diagnosticOrders.versionNumber, totalAmount: diagnosticOrders.totalAmount, currency: diagnosticOrders.currency, cancellationReason: diagnosticOrders.cancellationReason, createdAt: diagnosticOrders.createdAt, confirmedAt: diagnosticOrders.confirmedAt, cancelledAt: diagnosticOrders.cancelledAt }).from(diagnosticOrders).where(and(eq(diagnosticOrders.id, id), eq(diagnosticOrders.organizationId, base.staff.organizationId))).limit(1);
  if (!order) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("orders.read", order.centreId);
  if (access.response) return access.response;
  if (order.organizationId !== access.staff.organizationId) return Response.json({ error: "not_found" }, { status: 404 });
  const [items, history] = await Promise.all([
    db.select({ id: diagnosticOrderItems.id, serviceType: diagnosticOrderItems.serviceType, serviceCode: diagnosticOrderItems.serviceCode, displayName: diagnosticOrderItems.displayName, verificationStatus: diagnosticOrderItems.verificationStatus, priceAmount: diagnosticOrderItems.priceAmount, currency: diagnosticOrderItems.currency, priceSourceReference: diagnosticOrderItems.priceSourceReference, effectiveFrom: diagnosticOrderItems.effectiveFrom, effectiveUntil: diagnosticOrderItems.effectiveUntil, serviceSnapshot: diagnosticOrderItems.serviceSnapshot }).from(diagnosticOrderItems).where(and(eq(diagnosticOrderItems.orderId, id), eq(diagnosticOrderItems.organizationId, access.staff.organizationId), eq(diagnosticOrderItems.centreId, order.centreId), isNull(diagnosticOrderItems.removedAt))).orderBy(asc(diagnosticOrderItems.serviceCode)),
    db.select({ fromStatus: diagnosticOrderStatusHistory.fromStatus, toStatus: diagnosticOrderStatusHistory.toStatus, reason: diagnosticOrderStatusHistory.reason, versionNumber: diagnosticOrderStatusHistory.versionNumber, recordedAt: diagnosticOrderStatusHistory.recordedAt }).from(diagnosticOrderStatusHistory).where(and(eq(diagnosticOrderStatusHistory.orderId, id), eq(diagnosticOrderStatusHistory.organizationId, access.staff.organizationId), eq(diagnosticOrderStatusHistory.centreId, order.centreId))).orderBy(asc(diagnosticOrderStatusHistory.recordedAt)),
  ]);
  return Response.json({ order: { ...order, items, history } });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = orderUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const permission = parsed.data.action === "confirm" ? "orders.confirm" : parsed.data.action === "cancel" ? "orders.cancel" : "orders.create";
  const base = await getApiAccess(permission);
  if (base.response) return base.response;
  const db = getDb();
  const [initial] = await db.select({ organizationId: diagnosticOrders.organizationId, centreId: diagnosticOrders.centreId }).from(diagnosticOrders).where(and(eq(diagnosticOrders.id, id), eq(diagnosticOrders.organizationId, base.staff.organizationId))).limit(1);
  if (!initial) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess(permission, initial.centreId);
  if (access.response) return access.response;
  if (initial.organizationId !== access.staff.organizationId) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    const updated = await db.transaction(async (tx) => {
      const [order] = await tx.select().from(diagnosticOrders).where(and(eq(diagnosticOrders.id, id), eq(diagnosticOrders.organizationId, access.staff.organizationId), eq(diagnosticOrders.centreId, initial.centreId))).for("update").limit(1);
      if (!order) throw new Error("not_found");
      if (order.versionNumber !== parsed.data.expectedVersion) throw new Error("version_conflict");
      if (order.status === "CANCELLED") throw new Error("order_closed");
      if (parsed.data.action === "replace_items") {
        if (["CONFIRMED", "CANCELLED"].includes(order.status)) throw new Error("order_closed");
        const selected = await tx.select({ itemId: diagnosticCatalogueItems.id, itemType: diagnosticCatalogueItems.serviceType, serviceCode: diagnosticCatalogueItems.serviceCode, active: diagnosticCatalogueItems.active, versionId: diagnosticCatalogueVersions.id, versionNumber: diagnosticCatalogueVersions.versionNumber, currentVersion: diagnosticCatalogueItems.currentVersion, displayName: diagnosticCatalogueVersions.displayName, specimenRequirements: diagnosticCatalogueVersions.specimenRequirements, preparationInstructions: diagnosticCatalogueVersions.preparationInstructions, metropolisReferenceCode: diagnosticCatalogueVersions.metropolisReferenceCode, verificationStatus: diagnosticCatalogueVersions.verificationStatus, priceAmount: diagnosticCatalogueVersions.priceAmount, priceSourceReference: diagnosticCatalogueVersions.priceSourceReference, effectiveFrom: diagnosticCatalogueVersions.effectiveFrom, effectiveUntil: diagnosticCatalogueVersions.effectiveUntil }).from(diagnosticCatalogueVersions).innerJoin(diagnosticCatalogueItems, and(eq(diagnosticCatalogueItems.id, diagnosticCatalogueVersions.catalogueItemId), eq(diagnosticCatalogueItems.organizationId, diagnosticCatalogueVersions.organizationId), eq(diagnosticCatalogueItems.centreId, diagnosticCatalogueVersions.centreId), eq(diagnosticCatalogueItems.currentVersion, diagnosticCatalogueVersions.versionNumber))).where(and(eq(diagnosticCatalogueVersions.organizationId, order.organizationId), eq(diagnosticCatalogueVersions.centreId, order.centreId), inArray(diagnosticCatalogueVersions.id, parsed.data.catalogueVersionIds), eq(diagnosticCatalogueItems.active, true))).orderBy(asc(diagnosticCatalogueItems.serviceCode));
        if (selected.length !== parsed.data.catalogueVersionIds.length) throw new Error("catalogue_selection_not_current");
        const packageRows = selected.some((item) => item.itemType === "PACKAGE") ? await tx.select({ packageVersionId: diagnosticPackageComponents.packageVersionId, code: diagnosticCatalogueItems.serviceCode, name: diagnosticCatalogueVersions.displayName, version: diagnosticCatalogueVersions.versionNumber, verificationStatus: diagnosticCatalogueVersions.verificationStatus }).from(diagnosticPackageComponents).innerJoin(diagnosticCatalogueVersions, eq(diagnosticCatalogueVersions.id, diagnosticPackageComponents.testVersionId)).innerJoin(diagnosticCatalogueItems, eq(diagnosticCatalogueItems.id, diagnosticCatalogueVersions.catalogueItemId)).where(and(eq(diagnosticPackageComponents.organizationId, order.organizationId), eq(diagnosticPackageComponents.centreId, order.centreId), inArray(diagnosticPackageComponents.packageVersionId, selected.filter((item) => item.itemType === "PACKAGE").map((item) => item.versionId)))) : [];
        const included = (packageId: string) => packageRows.filter((row) => row.packageVersionId === packageId);
        if (hasOverlappingServices(selected.map((item) => ({ serviceType: item.itemType, serviceCode: item.serviceCode, components: included(item.versionId).map((component) => component.code) })))) throw new Error("overlapping_diagnostic_services");
        const snapshots = selected.map((item) => {
          const priceIsVerified = item.active && item.versionNumber === item.currentVersion && effectiveVerifiedPrice(item);
          return { item, priceIsVerified, serviceSnapshot: { specimenRequirements: item.specimenRequirements, preparationInstructions: item.preparationInstructions, metropolisReferenceCode: item.metropolisReferenceCode, catalogueVersion: item.versionNumber, packageComponents: included(item.versionId) } };
        });
        const nextStatus = snapshots.every((entry) => entry.priceIsVerified) ? "DRAFT" : "PENDING_VERIFICATION";
        await tx.update(diagnosticOrderItems).set({ removedAt: new Date(), removedByStaffId: access.staff.staffUserId, removalReason: parsed.data.reason }).where(and(eq(diagnosticOrderItems.orderId, id), eq(diagnosticOrderItems.organizationId, order.organizationId), eq(diagnosticOrderItems.centreId, order.centreId), isNull(diagnosticOrderItems.removedAt)));
        await tx.insert(diagnosticOrderItems).values(snapshots.map(({ item, priceIsVerified, serviceSnapshot }) => ({ organizationId: order.organizationId, centreId: order.centreId, orderId: id, catalogueItemId: item.itemId, catalogueVersionId: item.versionId, serviceType: item.itemType, serviceCode: item.serviceCode, displayName: item.displayName, verificationStatus: priceIsVerified ? "VERIFIED" : item.verificationStatus === "VERIFIED" ? "UNVERIFIED" : item.verificationStatus, priceAmount: priceIsVerified ? item.priceAmount : null, priceSourceReference: priceIsVerified ? item.priceSourceReference : null, effectiveFrom: priceIsVerified ? item.effectiveFrom : null, effectiveUntil: priceIsVerified ? item.effectiveUntil : null, serviceSnapshot })));
        const [result] = await tx.update(diagnosticOrders).set({ status: nextStatus, totalAmount: null, versionNumber: order.versionNumber + 1, updatedAt: new Date() }).where(and(eq(diagnosticOrders.id, id), eq(diagnosticOrders.versionNumber, order.versionNumber))).returning({ id: diagnosticOrders.id, orderNumber: diagnosticOrders.orderNumber, status: diagnosticOrders.status, versionNumber: diagnosticOrders.versionNumber });
        await tx.insert(diagnosticOrderStatusHistory).values({ organizationId: order.organizationId, centreId: order.centreId, orderId: id, fromStatus: order.status, toStatus: nextStatus, reason: parsed.data.reason, versionNumber: result.versionNumber, actorStaffId: access.staff.staffUserId });
        await appendAuditEvent(tx, { organizationId: order.organizationId, centreId: order.centreId, actorStaffId: access.staff.staffUserId, action: "diagnostic_order.items_replaced", entityType: "diagnostic_order", entityId: id, details: { itemCount: snapshots.length, status: nextStatus } });
        return result;
      }
      if (parsed.data.action === "confirm") {
        if (!["DRAFT", "PENDING_VERIFICATION"].includes(order.status)) throw new Error("invalid_order_state");
        const items = await tx.select({ catalogueItemId: diagnosticOrderItems.catalogueItemId, catalogueVersionId: diagnosticOrderItems.catalogueVersionId, verificationStatus: diagnosticOrderItems.verificationStatus, priceAmount: diagnosticOrderItems.priceAmount, priceSourceReference: diagnosticOrderItems.priceSourceReference, effectiveFrom: diagnosticOrderItems.effectiveFrom, effectiveUntil: diagnosticOrderItems.effectiveUntil, active: diagnosticCatalogueItems.active, currentVersion: diagnosticCatalogueItems.currentVersion, versionNumber: diagnosticCatalogueVersions.versionNumber }).from(diagnosticOrderItems).innerJoin(diagnosticCatalogueItems, and(eq(diagnosticCatalogueItems.id, diagnosticOrderItems.catalogueItemId), eq(diagnosticCatalogueItems.organizationId, diagnosticOrderItems.organizationId), eq(diagnosticCatalogueItems.centreId, diagnosticOrderItems.centreId))).innerJoin(diagnosticCatalogueVersions, and(eq(diagnosticCatalogueVersions.id, diagnosticOrderItems.catalogueVersionId), eq(diagnosticCatalogueVersions.organizationId, diagnosticOrderItems.organizationId), eq(diagnosticCatalogueVersions.centreId, diagnosticOrderItems.centreId))).where(and(eq(diagnosticOrderItems.orderId, id), eq(diagnosticOrderItems.organizationId, order.organizationId), eq(diagnosticOrderItems.centreId, order.centreId), isNull(diagnosticOrderItems.removedAt)));
        if (!items.length || items.some((item) => !item.active || item.versionNumber !== item.currentVersion || !effectiveVerifiedPrice({ verificationStatus: item.verificationStatus, priceAmount: item.priceAmount, priceSourceReference: item.priceSourceReference, effectiveFrom: item.effectiveFrom, effectiveUntil: item.effectiveUntil }))) throw new Error("order_prices_not_verified");
        const totalCents = items.reduce((sum, item) => sum + Math.round(Number(item.priceAmount) * 100), 0);
        const [result] = await tx.update(diagnosticOrders).set({ status: "CONFIRMED", totalAmount: (totalCents / 100).toFixed(2), confirmedByStaffId: access.staff.staffUserId, confirmedAt: new Date(), versionNumber: order.versionNumber + 1, updatedAt: new Date() }).where(and(eq(diagnosticOrders.id, id), eq(diagnosticOrders.versionNumber, order.versionNumber))).returning({ id: diagnosticOrders.id, orderNumber: diagnosticOrders.orderNumber, status: diagnosticOrders.status, versionNumber: diagnosticOrders.versionNumber, totalAmount: diagnosticOrders.totalAmount });
        await tx.insert(diagnosticOrderStatusHistory).values({ organizationId: order.organizationId, centreId: order.centreId, orderId: id, fromStatus: order.status, toStatus: "CONFIRMED", reason: "Source-verified catalogue prices confirmed", versionNumber: result.versionNumber, actorStaffId: access.staff.staffUserId });
        await appendAuditEvent(tx, { organizationId: order.organizationId, centreId: order.centreId, actorStaffId: access.staff.staffUserId, action: "diagnostic_order.confirmed", entityType: "diagnostic_order", entityId: id, details: { itemCount: items.length, totalAmount: result.totalAmount, currency: "INR" } });
        return result;
      }
      if (order.status === "CANCELLED") throw new Error("order_closed");
      const [result] = await tx.update(diagnosticOrders).set({ status: "CANCELLED", cancellationReason: parsed.data.reason, cancelledByStaffId: access.staff.staffUserId, cancelledAt: new Date(), versionNumber: order.versionNumber + 1, updatedAt: new Date() }).where(and(eq(diagnosticOrders.id, id), eq(diagnosticOrders.versionNumber, order.versionNumber))).returning({ id: diagnosticOrders.id, orderNumber: diagnosticOrders.orderNumber, status: diagnosticOrders.status, versionNumber: diagnosticOrders.versionNumber });
      await tx.insert(diagnosticOrderStatusHistory).values({ organizationId: order.organizationId, centreId: order.centreId, orderId: id, fromStatus: order.status, toStatus: "CANCELLED", reason: parsed.data.reason, versionNumber: result.versionNumber, actorStaffId: access.staff.staffUserId });
      await appendAuditEvent(tx, { organizationId: order.organizationId, centreId: order.centreId, actorStaffId: access.staff.staffUserId, action: "diagnostic_order.cancelled", entityType: "diagnostic_order", entityId: id, details: { fromStatus: order.status } });
      return result;
    });
    return Response.json({ order: updated });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const known = new Set(["version_conflict", "order_closed", "catalogue_selection_not_current", "overlapping_diagnostic_services", "invalid_order_state", "order_prices_not_verified", "not_found"]);
    if (known.has(code)) return Response.json({ error: code }, { status: code === "version_conflict" ? 409 : code === "not_found" ? 404 : 400 });
    return Response.json({ error: "order_update_conflict_or_unavailable" }, { status: 409 });
  }
}
