import { and, desc, eq, ilike, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appendAuditEvent } from "@/server/audit";
import { diagnosticCatalogueItems, diagnosticCatalogueVersions, diagnosticPackageComponents, centres } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { catalogueCreateSchema } from "@/server/catalogue-policy";

const filters = z.object({ centreId: z.uuid(), serviceType: z.enum(["TEST", "PACKAGE"]).optional(), q: z.string().trim().max(80).optional(), includeInactive: z.enum(["true", "false"]).default("false") });

export async function GET(request: Request) {
  const parsed = filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const access = await getApiAccess("catalogue.read", parsed.data.centreId);
  if (access.response) return access.response;
  const conditions = [eq(diagnosticCatalogueItems.organizationId, access.staff.organizationId), eq(diagnosticCatalogueItems.centreId, parsed.data.centreId), eq(diagnosticCatalogueVersions.versionNumber, diagnosticCatalogueItems.currentVersion)];
  if (parsed.data.serviceType) conditions.push(eq(diagnosticCatalogueItems.serviceType, parsed.data.serviceType));
  if (parsed.data.includeInactive !== "true") conditions.push(eq(diagnosticCatalogueItems.active, true));
  if (parsed.data.q) conditions.push(sql`(${ilike(diagnosticCatalogueItems.serviceCode, `%${parsed.data.q}%`)} OR ${ilike(diagnosticCatalogueVersions.displayName, `%${parsed.data.q}%`)})`);
  const items = await getDb().select({ id: diagnosticCatalogueItems.id, centreId: diagnosticCatalogueItems.centreId, serviceType: diagnosticCatalogueItems.serviceType, serviceCode: diagnosticCatalogueItems.serviceCode, currentVersion: diagnosticCatalogueItems.currentVersion, active: diagnosticCatalogueItems.active, publicVisible: diagnosticCatalogueItems.publicVisible, versionId: diagnosticCatalogueVersions.id, displayName: diagnosticCatalogueVersions.displayName, specimenRequirements: diagnosticCatalogueVersions.specimenRequirements, preparationInstructions: diagnosticCatalogueVersions.preparationInstructions, metropolisReferenceCode: diagnosticCatalogueVersions.metropolisReferenceCode, verificationStatus: diagnosticCatalogueVersions.verificationStatus, candidatePrice: diagnosticCatalogueVersions.priceAmount, verifiedPrice: sql<string | null>`CASE WHEN ${diagnosticCatalogueVersions.verificationStatus} = 'VERIFIED' THEN ${diagnosticCatalogueVersions.priceAmount} ELSE NULL END`, currency: diagnosticCatalogueVersions.currency, priceSourceReference: diagnosticCatalogueVersions.priceSourceReference, effectiveFrom: diagnosticCatalogueVersions.effectiveFrom, effectiveUntil: diagnosticCatalogueVersions.effectiveUntil, createdAt: diagnosticCatalogueVersions.createdAt })
    .from(diagnosticCatalogueItems).innerJoin(diagnosticCatalogueVersions, and(eq(diagnosticCatalogueVersions.catalogueItemId, diagnosticCatalogueItems.id), eq(diagnosticCatalogueVersions.organizationId, diagnosticCatalogueItems.organizationId), eq(diagnosticCatalogueVersions.centreId, diagnosticCatalogueItems.centreId))).where(and(...conditions)).orderBy(desc(diagnosticCatalogueItems.updatedAt)).limit(250);
  return Response.json({ items });
}

async function resolvePackageTests(tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], organizationId: string, centreId: string, codes: string[]) {
  if (!codes.length) return [];
  const result = await tx.select({ versionId: diagnosticCatalogueVersions.id, serviceCode: diagnosticCatalogueItems.serviceCode, serviceType: diagnosticCatalogueItems.serviceType }).from(diagnosticCatalogueItems).innerJoin(diagnosticCatalogueVersions, and(eq(diagnosticCatalogueVersions.catalogueItemId, diagnosticCatalogueItems.id), eq(diagnosticCatalogueVersions.versionNumber, diagnosticCatalogueItems.currentVersion), eq(diagnosticCatalogueVersions.organizationId, diagnosticCatalogueItems.organizationId), eq(diagnosticCatalogueVersions.centreId, diagnosticCatalogueItems.centreId))).where(and(eq(diagnosticCatalogueItems.organizationId, organizationId), eq(diagnosticCatalogueItems.centreId, centreId), eq(diagnosticCatalogueItems.serviceType, "TEST"), eq(diagnosticCatalogueItems.active, true), sql`${diagnosticCatalogueItems.serviceCode} = ANY(${codes})`));
  if (result.length !== codes.length || new Set(result.map((item) => item.serviceCode)).size !== codes.length) throw new Error("package_component_not_found");
  return result;
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const parsed = catalogueCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const access = await getApiAccess("catalogue.manage", parsed.data.centreId);
  if (access.response) return access.response;
  const db = getDb(); const data = parsed.data; const id = randomUUID();
  try {
    const result = await db.transaction(async (tx) => {
      const [centre] = await tx.select({ id: centres.id }).from(centres).where(and(eq(centres.id, data.centreId), eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"))).limit(1);
      if (!centre) throw new Error("centre_not_found");
      await tx.insert(diagnosticCatalogueItems).values({ id, organizationId: access.staff.organizationId, centreId: data.centreId, serviceType: data.serviceType, serviceCode: data.serviceCode, currentVersion: 1, createdByStaffId: access.staff.staffUserId });
      const versionId = randomUUID();
      await tx.insert(diagnosticCatalogueVersions).values({ id: versionId, organizationId: access.staff.organizationId, centreId: data.centreId, catalogueItemId: id, versionNumber: 1, displayName: data.displayName, specimenRequirements: data.specimenRequirements ?? null, preparationInstructions: data.preparationInstructions ?? null, metropolisReferenceCode: data.metropolisReferenceCode ?? null, verificationStatus: data.recordKind === "SYNTHETIC_TEST" ? "SYNTHETIC" : "UNVERIFIED", priceAmount: data.priceAmount ?? null, effectiveFrom: data.effectiveFrom ?? null, sourceType: data.recordKind, createdByStaffId: access.staff.staffUserId });
      if (data.serviceType === "PACKAGE") {
        const tests = await resolvePackageTests(tx, access.staff.organizationId, data.centreId, data.components);
        await tx.insert(diagnosticPackageComponents).values(tests.map((test) => ({ organizationId: access.staff.organizationId, centreId: data.centreId, packageVersionId: versionId, testVersionId: test.versionId })));
      }
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: data.centreId, actorStaffId: access.staff.staffUserId, action: "catalogue.item.created", entityType: "catalogue_item", entityId: id, details: { serviceType: data.serviceType, version: 1, verificationStatus: data.recordKind === "SYNTHETIC_TEST" ? "SYNTHETIC" : "UNVERIFIED", candidatePricePresent: Boolean(data.priceAmount) } });
      return { id, versionId, serviceCode: data.serviceCode, version: 1 };
    });
    return Response.json({ item: result }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "package_component_not_found") return Response.json({ error: "package_test_reference_not_found" }, { status: 400 });
    return Response.json({ error: "catalogue_item_conflict_or_unavailable" }, { status: 409 });
  }
}
