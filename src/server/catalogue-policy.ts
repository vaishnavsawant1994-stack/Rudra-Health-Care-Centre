import { z } from "zod";

export const catalogueTypes = ["TEST", "PACKAGE"] as const;
export const catalogueStatuses = ["SYNTHETIC", "UNVERIFIED", "VERIFIED", "INACTIVE"] as const;
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional().transform((value) => value || null);
const money = z.string().regex(/^\d{1,10}(?:\.\d{1,2})?$/, "Enter an amount in INR with up to two decimal places.").optional().nullable();

const catalogueObject = z.object({
  centreId: z.uuid(), serviceType: z.enum(catalogueTypes), serviceCode: z.string().trim().toUpperCase().min(1).max(80).regex(/^[A-Z0-9][A-Z0-9._-]*$/), displayName: z.string().trim().min(2).max(180), recordKind: z.enum(["MANUAL", "SYNTHETIC_TEST"]).default("MANUAL"),
  specimenRequirements: optionalText(500), preparationInstructions: optionalText(1000), metropolisReferenceCode: optionalText(100), priceAmount: money,
  effectiveFrom: z.iso.date().optional().nullable(), components: z.array(z.string().trim().toUpperCase().min(1).max(80)).max(100).default([]),
});

function validateCatalogueComponents(value: { serviceType: "TEST" | "PACKAGE"; components: string[]; recordKind: "MANUAL" | "SYNTHETIC_TEST"; priceAmount?: string | null }, ctx: z.RefinementCtx) {
  if (value.serviceType === "TEST" && value.components.length) ctx.addIssue({ code: "custom", path: ["components"], message: "Only package records can include tests." });
  if (value.serviceType === "PACKAGE" && !value.components.length) ctx.addIssue({ code: "custom", path: ["components"], message: "Add at least one included test to a package." });
  if (value.recordKind === "SYNTHETIC_TEST" && value.priceAmount) ctx.addIssue({ code: "custom", path: ["priceAmount"], message: "Synthetic catalogue records cannot contain prices." });
}

export const catalogueCreateSchema = catalogueObject.superRefine(validateCatalogueComponents);

export const catalogueUpdateSchema = catalogueObject.omit({ centreId: true, serviceType: true, serviceCode: true, components: true, recordKind: true }).extend({ components: z.array(z.string().trim().toUpperCase().min(1).max(80)).max(100).optional(), active: z.boolean().optional() });
export const cataloguePriceReviewSchema = z.object({ versionId: z.uuid(), sourceReference: z.string().trim().min(3).max(200), effectiveFrom: z.iso.date(), effectiveUntil: z.iso.date().nullable().optional(), reason: z.string().trim().min(3).max(240) }).refine((value) => !value.effectiveUntil || value.effectiveUntil > value.effectiveFrom, "Effective end must be after its start.");

export function cataloguePriceAuditDetails(input: { version: number; decision: "VERIFIED" | "REJECTED"; priceAmount: string | null; reviewId: string }) {
  // Source evidence and free-text reason remain in the permission-controlled
  // review record; even unkeyed digests in the audit chain invite offline guessing.
  return { version: input.version, decision: input.decision, priceAmount: input.priceAmount, reviewId: input.reviewId };
}

export function csvParse(input: string): { headers: string[]; rows: string[][] } {
  if (input.length > 1_000_000) throw new Error("CSV exceeds the 1 MB limit.");
  const rows: string[][] = [];
  let row: string[] = []; let cell = ""; let quoted = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { cell += '"'; i += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
    } else if (char === '"' && cell.length === 0) quoted = true;
    else if (char === ",") { row.push(cell.trim()); cell = ""; }
    else if (char === "\n") { row.push(cell.trim().replace(/\r$/, "")); cell = ""; if (row.some(Boolean)) rows.push(row); row = []; }
    else cell += char;
    if (rows.length > 1001) throw new Error("CSV is limited to 1,000 data rows.");
  }
  if (quoted) throw new Error("CSV contains an unclosed quoted field.");
  if (cell.length || row.length) { row.push(cell.trim().replace(/\r$/, "")); if (row.some(Boolean)) rows.push(row); }
  if (rows.length < 2) throw new Error("CSV needs a header row and at least one data row.");
  const headers = rows.shift()!.map((header) => header.trim().toLowerCase());
  if (new Set(headers).size !== headers.length || headers.some((header) => !header)) throw new Error("CSV headers must be non-empty and unique.");
  return { headers, rows };
}

export function validateCatalogueCsv(input: string) {
  const { headers, rows } = csvParse(input);
  const required = ["service_type", "service_code", "display_name"];
  if (required.some((header) => !headers.includes(header))) throw new Error(`CSV requires columns: ${required.join(", ")}.`);
  const seen = new Set<string>();
  const accepted: Array<Record<string, string>> = [];
  const errors: Array<{ row: number; code: string; message: string }> = [];
  rows.forEach((values, index) => {
    const data = Object.fromEntries(headers.map((header, col) => [header, values[col] ?? ""]));
    const key = `${data.service_type.toUpperCase()}:${data.service_code.toUpperCase()}`;
    if (seen.has(key)) { errors.push({ row: index + 2, code: "duplicate_in_file", message: "Service code appears more than once in this file." }); return; }
    seen.add(key);
    const record = catalogueCreateSchema.safeParse({ centreId: "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34", serviceType: data.service_type.toUpperCase(), serviceCode: data.service_code, displayName: data.display_name, specimenRequirements: data.specimen_requirements, preparationInstructions: data.preparation_instructions, metropolisReferenceCode: data.metropolis_reference_code, priceAmount: data.price_amount || undefined, effectiveFrom: data.effective_from || undefined, components: data.components ? data.components.split("|").map((code) => code.trim()).filter(Boolean) : [], recordKind: "MANUAL" });
    if (!record.success) errors.push({ row: index + 2, code: "invalid_row", message: record.error.issues.map((issue) => issue.message).join(" ") });
    else {
      const componentCodes = (data.components ?? "").split("|").map((code) => code.trim().toUpperCase()).filter(Boolean);
      if (data.service_type.toUpperCase() === "PACKAGE" && new Set(componentCodes).size !== componentCodes.length) errors.push({ row: index + 2, code: "duplicate_package_component", message: "A package cannot include the same test more than once." });
      else accepted.push({ ...data, source_row: String(index + 2) });
    }
  });
  return { accepted, errors };
}
