import { and, eq, gte, isNull, lte, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { appendAuditEvent } from "@/server/audit";
import { diagnosticCatalogueItems, diagnosticCatalogueVersions } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";

const bodySchema = z.object({ publicVisible: z.boolean(), expectedVersion: z.number().int().positive() });
type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_publication_input" }, { status: 400 });
  const base = await getApiAccess("catalogue.manage");
  if (base.response) return base.response;
  const [item] = await getDb().select().from(diagnosticCatalogueItems).where(and(eq(diagnosticCatalogueItems.id, id), eq(diagnosticCatalogueItems.organizationId, base.staff.organizationId))).limit(1);
  if (!item) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("catalogue.manage", item.centreId);
  if (access.response) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    const result = await getDb().transaction(async (tx) => {
      const [current] = await tx.select().from(diagnosticCatalogueItems).where(and(eq(diagnosticCatalogueItems.id, id), eq(diagnosticCatalogueItems.organizationId, access.staff.organizationId))).for("update").limit(1);
      if (!current) throw new Error("not_found");
      if (current.currentVersion !== parsed.data.expectedVersion) throw new Error("catalogue_changed");
      if (parsed.data.publicVisible && (!current.active || !(await tx.select({ id: diagnosticCatalogueVersions.id }).from(diagnosticCatalogueVersions).where(and(
        eq(diagnosticCatalogueVersions.catalogueItemId, current.id), eq(diagnosticCatalogueVersions.organizationId, current.organizationId), eq(diagnosticCatalogueVersions.centreId, current.centreId), eq(diagnosticCatalogueVersions.versionNumber, current.currentVersion), eq(diagnosticCatalogueVersions.verificationStatus, "VERIFIED"), sql`${diagnosticCatalogueVersions.priceAmount} IS NOT NULL`, sql`${diagnosticCatalogueVersions.effectiveFrom} IS NOT NULL`, lte(diagnosticCatalogueVersions.effectiveFrom, sql`CURRENT_DATE`), or(isNull(diagnosticCatalogueVersions.effectiveUntil), gte(diagnosticCatalogueVersions.effectiveUntil, sql`CURRENT_DATE`)),
      )).for("share").limit(1)).length)) throw new Error("catalogue_not_publicable");
      if (current.publicVisible === parsed.data.publicVisible) return { publicVisible: current.publicVisible, changed: false, version: current.currentVersion };
      const now = new Date();
      await tx.update(diagnosticCatalogueItems).set({ publicVisible: parsed.data.publicVisible, publicVisibilityUpdatedAt: now, publicVisibilityUpdatedByStaffId: access.staff.staffUserId, updatedAt: now }).where(and(eq(diagnosticCatalogueItems.id, current.id), eq(diagnosticCatalogueItems.currentVersion, parsed.data.expectedVersion)));
      await appendAuditEvent(tx, { organizationId: current.organizationId, centreId: current.centreId, actorStaffId: access.staff.staffUserId, action: parsed.data.publicVisible ? "catalogue.publication.enabled" : "catalogue.publication.disabled", entityType: "catalogue_item", entityId: current.id, details: { publicVisible: parsed.data.publicVisible, version: current.currentVersion } });
      return { publicVisible: parsed.data.publicVisible, changed: true, version: current.currentVersion };
    });
    return Response.json({ publication: result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const status = code === "not_found" ? 404 : code === "catalogue_changed" || code === "catalogue_not_publicable" ? 409 : 500;
    return Response.json({ error: status === 500 ? "catalogue_publication_failed" : code }, { status });
  }
}
