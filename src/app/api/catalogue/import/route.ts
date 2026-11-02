import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appendAuditEvent } from "@/server/audit";
import { catalogueImportBatches, diagnosticCatalogueItems, diagnosticCatalogueVersions, diagnosticPackageComponents } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { validateCatalogueCsv } from "@/server/catalogue-policy";

const bodySchema = z.object({ centreId: z.uuid(), mode: z.enum(["preview", "commit"]), sourceReference: z.string().trim().min(3).max(200), csv: z.string().min(1).max(1_000_000), expectedDigest: z.string().regex(/^[a-f0-9]{64}$/).optional() });

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_import_request" }, { status: 400 });
  const access = await getApiAccess("catalogue.import", parsed.data.centreId);
  if (access.response) return access.response;
  let validation;
  try { validation = validateCatalogueCsv(parsed.data.csv); }
  catch (error) { return Response.json({ error: "invalid_csv", message: error instanceof Error ? error.message : "CSV could not be read." }, { status: 400 }); }
  const digest = createHash("sha256").update(parsed.data.csv).digest("hex");
  if (parsed.data.mode === "preview") {
    const codes = validation.accepted.map((row) => row.service_code.toUpperCase());
    const existing = codes.length ? await getDb().select({ serviceCode: diagnosticCatalogueItems.serviceCode, serviceType: diagnosticCatalogueItems.serviceType }).from(diagnosticCatalogueItems).where(and(eq(diagnosticCatalogueItems.organizationId, access.staff.organizationId), eq(diagnosticCatalogueItems.centreId, parsed.data.centreId), inArray(diagnosticCatalogueItems.serviceCode, codes))) : [];
    const existingKeys = new Set(existing.map((row) => `${row.serviceType}:${row.serviceCode}`));
    const availableTestCodes = new Set([...existing.filter((row) => row.serviceType === "TEST").map((row) => row.serviceCode.toUpperCase()), ...validation.accepted.filter((row) => row.service_type.toUpperCase() === "TEST").map((row) => row.service_code.toUpperCase())]);
    const errors = [...validation.errors, ...validation.accepted.flatMap((row) => {
      const rowNumber = Number(row.source_row);
      const duplicate = existingKeys.has(`${row.service_type.toUpperCase()}:${row.service_code.toUpperCase()}`) ? [{ row: rowNumber, code: "already_exists", message: "This centre already has that service type and code; import does not overwrite existing versions." }] : [];
      const missingComponents = row.service_type.toUpperCase() === "PACKAGE" ? (row.components ?? "").split("|").map((code) => code.trim().toUpperCase()).filter(Boolean).filter((code) => !availableTestCodes.has(code)).map((code) => ({ row: rowNumber, code: "package_component_not_found", message: `Package component ${code} is not an existing or imported diagnostic test.` })) : [];
      return [...duplicate, ...missingComponents];
    })];
    return Response.json({ digest, rowCount: validation.accepted.length + validation.errors.length, acceptedCount: errors.length ? 0 : validation.accepted.length, errors, pricePolicy: "Imported amounts remain unverified candidates and are never shown as approved prices." });
  }
  if (!parsed.data.expectedDigest || parsed.data.expectedDigest !== digest) return Response.json({ error: "preview_digest_mismatch" }, { status: 409 });
  if (validation.errors.length) return Response.json({ error: "import_has_validation_errors", errors: validation.errors }, { status: 422 });
  const db = getDb();
  try {
    const result = await db.transaction(async (tx) => {
      const batchId = randomUUID();
      const nowCodes = validation.accepted.map((row) => row.service_code.toUpperCase());
      const existing = nowCodes.length ? await tx.select({ serviceCode: diagnosticCatalogueItems.serviceCode, serviceType: diagnosticCatalogueItems.serviceType }).from(diagnosticCatalogueItems).where(and(eq(diagnosticCatalogueItems.organizationId, access.staff.organizationId), eq(diagnosticCatalogueItems.centreId, parsed.data.centreId), inArray(diagnosticCatalogueItems.serviceCode, nowCodes))).for("update") : [];
      const existingKeys = new Set(existing.map((row) => `${row.serviceType}:${row.serviceCode}`));
      if (validation.accepted.some((row) => existingKeys.has(`${row.service_type.toUpperCase()}:${row.service_code.toUpperCase()}`))) throw new Error("code_conflict");
      const existingTests = await tx.select({ serviceCode: diagnosticCatalogueItems.serviceCode }).from(diagnosticCatalogueItems).where(and(eq(diagnosticCatalogueItems.organizationId, access.staff.organizationId), eq(diagnosticCatalogueItems.centreId, parsed.data.centreId), eq(diagnosticCatalogueItems.serviceType, "TEST")));
      const availableTestCodes = new Set([...existingTests.map((row) => row.serviceCode.toUpperCase()), ...validation.accepted.filter((row) => row.service_type.toUpperCase() === "TEST").map((row) => row.service_code.toUpperCase())]);
      if (validation.accepted.some((row) => row.service_type.toUpperCase() === "PACKAGE" && (row.components ?? "").split("|").map((code) => code.trim().toUpperCase()).filter(Boolean).some((code) => !availableTestCodes.has(code)))) throw new Error("package_component_not_found");
      await tx.insert(catalogueImportBatches).values({ id: batchId, organizationId: access.staff.organizationId, centreId: parsed.data.centreId, fileDigest: digest, rowCount: validation.accepted.length, createdCount: validation.accepted.length, sourceReference: parsed.data.sourceReference, importedByStaffId: access.staff.staffUserId });
      const ordered = [...validation.accepted].sort((a, b) => (a.service_type === "TEST" ? 0 : 1) - (b.service_type === "TEST" ? 0 : 1));
      const codeMap = new Map<string, { versionId: string; versionType: string }>();
      for (const row of ordered) {
        const itemId = randomUUID(); const versionId = randomUUID(); const type = row.service_type.toUpperCase(); const code = row.service_code.toUpperCase();
        await tx.insert(diagnosticCatalogueItems).values({ id: itemId, organizationId: access.staff.organizationId, centreId: parsed.data.centreId, serviceType: type, serviceCode: code, currentVersion: 1, createdByStaffId: access.staff.staffUserId });
        await tx.insert(diagnosticCatalogueVersions).values({ id: versionId, organizationId: access.staff.organizationId, centreId: parsed.data.centreId, catalogueItemId: itemId, versionNumber: 1, displayName: row.display_name.trim(), specimenRequirements: row.specimen_requirements || null, preparationInstructions: row.preparation_instructions || null, metropolisReferenceCode: row.metropolis_reference_code || null, verificationStatus: "UNVERIFIED", priceAmount: row.price_amount || null, effectiveFrom: row.effective_from || null, importBatchId: batchId, sourceType: "CSV_IMPORT", createdByStaffId: access.staff.staffUserId });
        codeMap.set(code, { versionId, versionType: type });
        if (type === "PACKAGE") {
          const componentCodes = (row.components ?? "").split("|").map((value) => value.trim().toUpperCase()).filter(Boolean);
          const tests = componentCodes.map((code) => codeMap.get(code)).filter((value) => value?.versionType === "TEST") as Array<{ versionId: string; versionType: string }>;
          if (tests.length !== componentCodes.length || new Set(componentCodes).size !== componentCodes.length) throw new Error("package_component_not_found");
          if (tests.length) await tx.insert(diagnosticPackageComponents).values(tests.map((test) => ({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, packageVersionId: versionId, testVersionId: test.versionId })));
        }
      }
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: parsed.data.centreId, actorStaffId: access.staff.staffUserId, action: "catalogue.imported", entityType: "catalogue_import_batch", entityId: batchId, details: { digest, rowCount: validation.accepted.length, status: "UNVERIFIED" } });
      return { id: batchId, importedCount: validation.accepted.length };
    });
    return Response.json({ batch: result }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error && error.message === "package_component_not_found" ? "package_component_reference_invalid" : "import_conflict_or_unavailable" }, { status: 409 });
  }
}
