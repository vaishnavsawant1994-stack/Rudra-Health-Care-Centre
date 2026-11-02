import { and, asc, eq, ilike, isNull, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { centrePublicProfiles, centres, diagnosticCatalogueItems, diagnosticCatalogueVersions, diagnosticPackageComponents } from "@/db/schema";
import { decryptCentrePublicProfile } from "@/server/centre-public-profile";

export type PublicCatalogueFilters = { centreId?: string; serviceType?: "TEST" | "PACKAGE"; query?: string; page?: number; pageSize?: number };
export type PublicCatalogueItem = {
  id: string;
  centreId: string;
  centreName: string;
  serviceType: "TEST" | "PACKAGE";
  serviceCode: string;
  version: number;
  displayName: string;
  specimenRequirements: string | null;
  preparationInstructions: string | null;
  priceAmount: string;
  currency: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
};
export type PublicCatalogueDetail = PublicCatalogueItem & {
  includedTests: Array<Pick<PublicCatalogueItem, "id" | "serviceCode" | "displayName" | "specimenRequirements" | "preparationInstructions">>;
};

export function isPublicCatalogueVersionEligible(input: {
  active: boolean;
  publicVisible: boolean;
  verificationStatus: string;
  priceAmount: string | null;
  effectiveFrom: string | null;
  effectiveUntil: string | null;
}, today: string) {
  return input.active && input.publicVisible && input.verificationStatus === "VERIFIED"
    && input.priceAmount !== null && input.effectiveFrom !== null && input.effectiveFrom <= today
    && (input.effectiveUntil === null || input.effectiveUntil >= today);
}

const publicEligibility = [
  eq(centres.status, "ACTIVE"),
  eq(diagnosticCatalogueItems.active, true),
  eq(diagnosticCatalogueItems.publicVisible, true),
  eq(diagnosticCatalogueVersions.versionNumber, diagnosticCatalogueItems.currentVersion),
  eq(diagnosticCatalogueVersions.verificationStatus, "VERIFIED"),
  sql`${diagnosticCatalogueVersions.priceAmount} IS NOT NULL`,
  sql`${diagnosticCatalogueVersions.effectiveFrom} IS NOT NULL AND ${diagnosticCatalogueVersions.effectiveFrom} <= CURRENT_DATE`,
  or(isNull(diagnosticCatalogueVersions.effectiveUntil), sql`${diagnosticCatalogueVersions.effectiveUntil} >= CURRENT_DATE`),
];

export async function listPublicCatalogue(filters: PublicCatalogueFilters = {}): Promise<{ items: PublicCatalogueItem[]; page: number; pageSize: number; hasMore: boolean }> {
  const page = filters.page ?? 1;
  const pageSize = filters.pageSize ?? 50;
  const conditions = [...publicEligibility];
  if (filters.centreId) conditions.push(eq(centres.id, filters.centreId));
  if (filters.serviceType) conditions.push(eq(diagnosticCatalogueItems.serviceType, filters.serviceType));
  if (filters.query) conditions.push(sql`(${ilike(diagnosticCatalogueItems.serviceCode, `%${filters.query}%`)} OR ${ilike(diagnosticCatalogueVersions.displayName, `%${filters.query}%`)})`);
  const rows = await getDb().select({ id: diagnosticCatalogueItems.id, centreId: centres.id, centreName: centres.name, active: diagnosticCatalogueItems.active, publicVisible: diagnosticCatalogueItems.publicVisible, serviceType: diagnosticCatalogueItems.serviceType, serviceCode: diagnosticCatalogueItems.serviceCode, version: diagnosticCatalogueVersions.versionNumber, displayName: diagnosticCatalogueVersions.displayName, specimenRequirements: diagnosticCatalogueVersions.specimenRequirements, preparationInstructions: diagnosticCatalogueVersions.preparationInstructions, verificationStatus: diagnosticCatalogueVersions.verificationStatus, priceAmount: diagnosticCatalogueVersions.priceAmount, currency: diagnosticCatalogueVersions.currency, effectiveFrom: diagnosticCatalogueVersions.effectiveFrom, effectiveUntil: diagnosticCatalogueVersions.effectiveUntil, databaseToday: sql<string>`CURRENT_DATE::text` })
    .from(diagnosticCatalogueItems)
    .innerJoin(centres, and(eq(centres.id, diagnosticCatalogueItems.centreId), eq(centres.organizationId, diagnosticCatalogueItems.organizationId)))
    .innerJoin(diagnosticCatalogueVersions, and(eq(diagnosticCatalogueVersions.catalogueItemId, diagnosticCatalogueItems.id), eq(diagnosticCatalogueVersions.organizationId, diagnosticCatalogueItems.organizationId), eq(diagnosticCatalogueVersions.centreId, diagnosticCatalogueItems.centreId)))
    .where(and(...conditions)).orderBy(asc(centres.name), asc(diagnosticCatalogueItems.serviceType), asc(diagnosticCatalogueVersions.displayName), asc(diagnosticCatalogueItems.id)).limit(pageSize + 1).offset((page - 1) * pageSize);
  const eligible = rows.filter((row): row is typeof row & { serviceType: "TEST" | "PACKAGE"; priceAmount: string; effectiveFrom: string } =>
    (row.serviceType === "TEST" || row.serviceType === "PACKAGE")
    && isPublicCatalogueVersionEligible({ active: row.active, publicVisible: row.publicVisible, verificationStatus: row.verificationStatus, priceAmount: row.priceAmount, effectiveFrom: row.effectiveFrom, effectiveUntil: row.effectiveUntil }, row.databaseToday))
    .map((row) => ({ id: row.id, centreId: row.centreId, centreName: row.centreName, serviceType: row.serviceType, serviceCode: row.serviceCode, version: row.version, displayName: row.displayName, specimenRequirements: row.specimenRequirements, preparationInstructions: row.preparationInstructions, priceAmount: row.priceAmount, currency: row.currency, effectiveFrom: row.effectiveFrom, effectiveUntil: row.effectiveUntil }));
  return { items: eligible.slice(0, pageSize), page, pageSize, hasMore: eligible.length > pageSize };
}

/** Returns a service only while its current version is explicitly published and price-effective. */
export async function getPublicCatalogueItem(id: string): Promise<PublicCatalogueDetail | null> {
  const [row] = await getDb().select({
    id: diagnosticCatalogueItems.id, centreId: centres.id, centreName: centres.name,
    active: diagnosticCatalogueItems.active, publicVisible: diagnosticCatalogueItems.publicVisible,
    serviceType: diagnosticCatalogueItems.serviceType, serviceCode: diagnosticCatalogueItems.serviceCode,
    currentVersion: diagnosticCatalogueItems.currentVersion, versionId: diagnosticCatalogueVersions.id,
    version: diagnosticCatalogueVersions.versionNumber, displayName: diagnosticCatalogueVersions.displayName,
    specimenRequirements: diagnosticCatalogueVersions.specimenRequirements,
    preparationInstructions: diagnosticCatalogueVersions.preparationInstructions,
    verificationStatus: diagnosticCatalogueVersions.verificationStatus, priceAmount: diagnosticCatalogueVersions.priceAmount,
    currency: diagnosticCatalogueVersions.currency, effectiveFrom: diagnosticCatalogueVersions.effectiveFrom,
    effectiveUntil: diagnosticCatalogueVersions.effectiveUntil, databaseToday: sql<string>`CURRENT_DATE::text`,
  }).from(diagnosticCatalogueItems)
    .innerJoin(centres, and(eq(centres.id, diagnosticCatalogueItems.centreId), eq(centres.organizationId, diagnosticCatalogueItems.organizationId)))
    .innerJoin(diagnosticCatalogueVersions, and(eq(diagnosticCatalogueVersions.catalogueItemId, diagnosticCatalogueItems.id), eq(diagnosticCatalogueVersions.organizationId, diagnosticCatalogueItems.organizationId), eq(diagnosticCatalogueVersions.centreId, diagnosticCatalogueItems.centreId)))
    .where(and(...publicEligibility, eq(diagnosticCatalogueItems.id, id))).limit(1);
  if (!row || (row.serviceType !== "TEST" && row.serviceType !== "PACKAGE")
    || !isPublicCatalogueVersionEligible({ active: row.active, publicVisible: row.publicVisible, verificationStatus: row.verificationStatus, priceAmount: row.priceAmount, effectiveFrom: row.effectiveFrom, effectiveUntil: row.effectiveUntil }, row.databaseToday)
    || row.version !== row.currentVersion || !row.priceAmount || !row.effectiveFrom) return null;

  let includedTests: PublicCatalogueDetail["includedTests"] = [];
  if (row.serviceType === "PACKAGE") {
    const components = await getDb().select({
      id: diagnosticCatalogueItems.id, active: diagnosticCatalogueItems.active, publicVisible: diagnosticCatalogueItems.publicVisible,
      serviceType: diagnosticCatalogueItems.serviceType, serviceCode: diagnosticCatalogueItems.serviceCode,
      currentVersion: diagnosticCatalogueItems.currentVersion, version: diagnosticCatalogueVersions.versionNumber,
      displayName: diagnosticCatalogueVersions.displayName, specimenRequirements: diagnosticCatalogueVersions.specimenRequirements,
      preparationInstructions: diagnosticCatalogueVersions.preparationInstructions, verificationStatus: diagnosticCatalogueVersions.verificationStatus,
      priceAmount: diagnosticCatalogueVersions.priceAmount, effectiveFrom: diagnosticCatalogueVersions.effectiveFrom,
      effectiveUntil: diagnosticCatalogueVersions.effectiveUntil, databaseToday: sql<string>`CURRENT_DATE::text`,
    }).from(diagnosticPackageComponents)
      .innerJoin(diagnosticCatalogueVersions, and(eq(diagnosticCatalogueVersions.id, diagnosticPackageComponents.testVersionId), eq(diagnosticCatalogueVersions.organizationId, diagnosticPackageComponents.organizationId), eq(diagnosticCatalogueVersions.centreId, diagnosticPackageComponents.centreId)))
      .innerJoin(diagnosticCatalogueItems, and(eq(diagnosticCatalogueItems.id, diagnosticCatalogueVersions.catalogueItemId), eq(diagnosticCatalogueItems.organizationId, diagnosticCatalogueVersions.organizationId), eq(diagnosticCatalogueItems.centreId, diagnosticCatalogueVersions.centreId)))
      .innerJoin(centres, and(eq(centres.id, diagnosticCatalogueItems.centreId), eq(centres.organizationId, diagnosticCatalogueItems.organizationId)))
      .where(and(eq(diagnosticPackageComponents.packageVersionId, row.versionId), ...publicEligibility, eq(diagnosticCatalogueItems.serviceType, "TEST")))
      .orderBy(asc(diagnosticCatalogueVersions.displayName), asc(diagnosticCatalogueItems.id));
    includedTests = components.filter((component) => component.version === component.currentVersion
      && isPublicCatalogueVersionEligible({ active: component.active, publicVisible: component.publicVisible, verificationStatus: component.verificationStatus, priceAmount: component.priceAmount, effectiveFrom: component.effectiveFrom, effectiveUntil: component.effectiveUntil }, component.databaseToday))
      .map(({ id: componentId, serviceCode, displayName, specimenRequirements, preparationInstructions }) => ({ id: componentId, serviceCode, displayName, specimenRequirements, preparationInstructions }));
  }
  return { id: row.id, centreId: row.centreId, centreName: row.centreName, serviceType: row.serviceType,
    serviceCode: row.serviceCode, version: row.version, displayName: row.displayName,
    specimenRequirements: row.specimenRequirements, preparationInstructions: row.preparationInstructions,
    priceAmount: row.priceAmount, currency: row.currency, effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil, includedTests };
}

export async function listPublicCatalogueCentres() {
  const rows = await getDb().selectDistinct({ id: centres.id, organizationId: centres.organizationId, code: centres.code, name: centres.name, profileCiphertext: centrePublicProfiles.profileCiphertext })
    .from(centres)
    .innerJoin(diagnosticCatalogueItems, and(eq(diagnosticCatalogueItems.centreId, centres.id), eq(diagnosticCatalogueItems.organizationId, centres.organizationId)))
    .innerJoin(diagnosticCatalogueVersions, and(eq(diagnosticCatalogueVersions.catalogueItemId, diagnosticCatalogueItems.id), eq(diagnosticCatalogueVersions.organizationId, diagnosticCatalogueItems.organizationId), eq(diagnosticCatalogueVersions.centreId, diagnosticCatalogueItems.centreId)))
    .leftJoin(centrePublicProfiles, and(eq(centrePublicProfiles.centreId, centres.id), eq(centrePublicProfiles.organizationId, centres.organizationId), eq(centrePublicProfiles.published, true)))
    .where(and(...publicEligibility)).orderBy(asc(centres.name));
  return rows.map(({ organizationId, profileCiphertext, ...centre }) => {
    if (!profileCiphertext) return { ...centre, publicProfile: null };
    const profile = decryptCentrePublicProfile(profileCiphertext, organizationId, centre.id);
    return { ...centre, name: profile.displayName, publicProfile: { address: profile.address, phone: profile.phone, email: profile.email, serviceArea: profile.serviceArea, openingHours: profile.openingHours } };
  });
}
