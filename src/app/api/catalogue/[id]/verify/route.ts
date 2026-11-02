import { and, eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appendAuditEvent } from "@/server/audit";
import { cataloguePriceReviews, diagnosticCatalogueItems, diagnosticCatalogueVersions } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { cataloguePriceAuditDetails, cataloguePriceReviewSchema } from "@/server/catalogue-policy";

type Context = { params: Promise<{ id: string }> };
const schema = cataloguePriceReviewSchema.extend({ decision: z.enum(["VERIFIED", "REJECTED"]) });

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_review", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const base = await getApiAccess("catalogue.price.verify");
  if (base.response) return base.response;
  const db = getDb();
  const [item] = await db.select().from(diagnosticCatalogueItems).where(and(eq(diagnosticCatalogueItems.id, id), eq(diagnosticCatalogueItems.organizationId, base.staff.organizationId))).limit(1);
  if (!item) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("catalogue.price.verify", item.centreId);
  if (access.response) return access.response;
  try {
    const result = await db.transaction(async (tx) => {
      const [version] = await tx.select().from(diagnosticCatalogueVersions).where(and(eq(diagnosticCatalogueVersions.id, parsed.data.versionId), eq(diagnosticCatalogueVersions.catalogueItemId, item.id), eq(diagnosticCatalogueVersions.organizationId, access.staff.organizationId), eq(diagnosticCatalogueVersions.centreId, item.centreId))).for("update").limit(1);
      if (!version || version.versionNumber !== item.currentVersion || version.verificationStatus !== "UNVERIFIED" || version.priceAmount === null) throw new Error("version_not_reviewable");
      if (parsed.data.decision === "VERIFIED") {
        await tx.update(diagnosticCatalogueVersions).set({ verificationStatus: "VERIFIED", priceSourceReference: parsed.data.sourceReference, effectiveFrom: parsed.data.effectiveFrom, effectiveUntil: parsed.data.effectiveUntil ?? null, reviewedByStaffId: access.staff.staffUserId, reviewedAt: new Date() }).where(eq(diagnosticCatalogueVersions.id, version.id));
      }
      const reviewId = randomUUID();
      await tx.insert(cataloguePriceReviews).values({ id: reviewId, organizationId: item.organizationId, centreId: item.centreId, catalogueVersionId: version.id, decision: parsed.data.decision, sourceReference: parsed.data.sourceReference, effectiveFrom: parsed.data.effectiveFrom, effectiveUntil: parsed.data.effectiveUntil ?? null, reviewedByStaffId: access.staff.staffUserId, reason: parsed.data.reason });
      await appendAuditEvent(tx, { organizationId: item.organizationId, centreId: item.centreId, actorStaffId: access.staff.staffUserId, action: `catalogue.price.${parsed.data.decision.toLowerCase()}`, entityType: "catalogue_version", entityId: version.id, details: cataloguePriceAuditDetails({ version: version.versionNumber, decision: parsed.data.decision, priceAmount: version.priceAmount, reviewId }) });
      return { reviewId, status: parsed.data.decision === "VERIFIED" ? "VERIFIED" : "UNVERIFIED" };
    });
    return Response.json({ review: result });
  } catch {
    return Response.json({ error: "catalogue_version_not_reviewable" }, { status: 409 });
  }
}
