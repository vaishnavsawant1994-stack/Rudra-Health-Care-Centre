import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appendAuditEvent } from "@/server/audit";
import { diagnosticCatalogueItems, diagnosticCatalogueVersions, diagnosticPackageComponents } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { catalogueUpdateSchema } from "@/server/catalogue-policy";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const base = await getApiAccess("catalogue.read");
  if (base.response) return base.response;
  const db = getDb();
  const [item] = await db.select().from(diagnosticCatalogueItems).where(and(eq(diagnosticCatalogueItems.id, id), eq(diagnosticCatalogueItems.organizationId, base.staff.organizationId))).limit(1);
  if (!item) return Response.json({ error: "not_found" }, { status: 404 });
  const allowed = await getApiAccess("catalogue.read", item.centreId);
  if (allowed.response) return Response.json({ error: "not_found" }, { status: 404 });
  const versions = await db.select().from(diagnosticCatalogueVersions).where(and(eq(diagnosticCatalogueVersions.catalogueItemId, item.id), eq(diagnosticCatalogueVersions.organizationId, item.organizationId))).orderBy(desc(diagnosticCatalogueVersions.versionNumber));
  const currentVersion = versions.find((version) => version.versionNumber === item.currentVersion);
  const components = currentVersion && item.serviceType === "PACKAGE" ? await db.select({ serviceCode: diagnosticCatalogueItems.serviceCode, displayName: diagnosticCatalogueVersions.displayName, version: diagnosticCatalogueVersions.versionNumber, verificationStatus: diagnosticCatalogueVersions.verificationStatus }).from(diagnosticPackageComponents).innerJoin(diagnosticCatalogueVersions, and(eq(diagnosticCatalogueVersions.id, diagnosticPackageComponents.testVersionId), eq(diagnosticCatalogueVersions.organizationId, diagnosticPackageComponents.organizationId), eq(diagnosticCatalogueVersions.centreId, diagnosticPackageComponents.centreId))).innerJoin(diagnosticCatalogueItems, and(eq(diagnosticCatalogueItems.id, diagnosticCatalogueVersions.catalogueItemId), eq(diagnosticCatalogueItems.organizationId, diagnosticCatalogueVersions.organizationId), eq(diagnosticCatalogueItems.centreId, diagnosticCatalogueVersions.centreId))).where(and(eq(diagnosticPackageComponents.packageVersionId, currentVersion.id), eq(diagnosticPackageComponents.organizationId, item.organizationId))).orderBy(asc(diagnosticCatalogueItems.serviceCode)) : [];
  return Response.json({ item, versions, components });
}

export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const base = await getApiAccess("catalogue.manage");
  if (base.response) return base.response;
  const parsed = catalogueUpdateSchema.extend({ expectedVersion: z.number().int().positive() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const db = getDb();
  const [item] = await db.select().from(diagnosticCatalogueItems).where(and(eq(diagnosticCatalogueItems.id, id), eq(diagnosticCatalogueItems.organizationId, base.staff.organizationId))).limit(1);
  if (!item) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("catalogue.manage", item.centreId);
  if (access.response) return access.response;
  const data = parsed.data;
  try {
    const result = await db.transaction(async (tx) => {
      const [current] = await tx.select().from(diagnosticCatalogueItems).where(and(eq(diagnosticCatalogueItems.id, id), eq(diagnosticCatalogueItems.organizationId, access.staff.organizationId))).for("update").limit(1);
      if (!current || current.currentVersion !== data.expectedVersion) throw new Error("stale_version");
      const [previous] = await tx.select().from(diagnosticCatalogueVersions).where(and(eq(diagnosticCatalogueVersions.catalogueItemId, current.id), eq(diagnosticCatalogueVersions.versionNumber, current.currentVersion), eq(diagnosticCatalogueVersions.organizationId, current.organizationId))).limit(1);
      if (!previous) throw new Error("version_missing");
      const versionId = randomUUID(); const nextVersion = current.currentVersion + 1;
      await tx.insert(diagnosticCatalogueVersions).values({ id: versionId, organizationId: current.organizationId, centreId: current.centreId, catalogueItemId: current.id, versionNumber: nextVersion, displayName: data.displayName ?? previous.displayName, specimenRequirements: data.specimenRequirements === undefined ? previous.specimenRequirements : data.specimenRequirements, preparationInstructions: data.preparationInstructions === undefined ? previous.preparationInstructions : data.preparationInstructions, metropolisReferenceCode: data.metropolisReferenceCode === undefined ? previous.metropolisReferenceCode : data.metropolisReferenceCode, verificationStatus: "UNVERIFIED", priceAmount: data.priceAmount === undefined ? previous.priceAmount : data.priceAmount, effectiveFrom: data.effectiveFrom === undefined ? previous.effectiveFrom : data.effectiveFrom, sourceType: "MANUAL", createdByStaffId: access.staff.staffUserId });
      const active = data.active ?? current.active;
      const updatedAt = new Date();
      await tx.update(diagnosticCatalogueItems).set({ currentVersion: nextVersion, active, publicVisible: false, ...(current.publicVisible ? { publicVisibilityUpdatedAt: updatedAt, publicVisibilityUpdatedByStaffId: access.staff.staffUserId } : {}), updatedAt }).where(eq(diagnosticCatalogueItems.id, current.id));
      if (current.serviceType === "PACKAGE") {
        const codes = data.components?.length ? data.components : [];
        if (!codes.length) throw new Error("package_component_not_found");
        const tests = await tx.select({ id: diagnosticCatalogueVersions.id, code: diagnosticCatalogueItems.serviceCode }).from(diagnosticCatalogueItems).innerJoin(diagnosticCatalogueVersions, and(eq(diagnosticCatalogueVersions.catalogueItemId, diagnosticCatalogueItems.id), eq(diagnosticCatalogueVersions.versionNumber, diagnosticCatalogueItems.currentVersion), eq(diagnosticCatalogueVersions.organizationId, diagnosticCatalogueItems.organizationId), eq(diagnosticCatalogueVersions.centreId, diagnosticCatalogueItems.centreId))).where(and(eq(diagnosticCatalogueItems.organizationId, current.organizationId), eq(diagnosticCatalogueItems.centreId, current.centreId), eq(diagnosticCatalogueItems.serviceType, "TEST"), inArray(diagnosticCatalogueItems.serviceCode, codes)));
        if (tests.length !== codes.length || new Set(codes).size !== codes.length) throw new Error("package_component_not_found");
        await tx.insert(diagnosticPackageComponents).values(tests.map((test) => ({ organizationId: current.organizationId, centreId: current.centreId, packageVersionId: versionId, testVersionId: test.id })));
      }
      await appendAuditEvent(tx, { organizationId: current.organizationId, centreId: current.centreId, actorStaffId: access.staff.staffUserId, action: "catalogue.item.versioned", entityType: "catalogue_item", entityId: current.id, details: { version: nextVersion, status: "UNVERIFIED", active, publicVisible: false, previousVersionWasPublic: current.publicVisible } });
      return { versionId, version: nextVersion };
    });
    return Response.json({ item: result });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message === "package_component_not_found" ? "package_test_reference_not_found" : error instanceof Error && error.message === "stale_version" ? "catalogue_changed_refresh_required" : "catalogue_update_conflict" }, { status: 409 });
  }
}
