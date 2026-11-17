import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { getDb } from "@/db/client";
import { centres, diagnosticOrders, metropolisReferenceMappings, specimens } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { blindIndexMetropolisReference } from "@/server/metropolis-crypto";
import { metropolisReferenceMatchesTarget, metropolisReferenceSchema } from "@/server/metropolis-policy";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { z } from "zod";

const id = z.uuid();

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const centreId = params.get("centreId") ?? undefined;
  if (centreId && !id.safeParse(centreId).success) return Response.json({ error: "invalid_centre" }, { status: 400 });
  const access = await getApiAccess("samples.read", centreId);
  if (access.response) return access.response;
  const scopes = access.staff.grants.filter((grant) => grant.key === "samples.read").map((grant) => grant.centreId);
  const where = [eq(metropolisReferenceMappings.organizationId, access.staff.organizationId)];
  if (centreId) where.push(eq(metropolisReferenceMappings.centreId, centreId));
  if (!scopes.includes(null)) where.push(scopes.length ? inArray(metropolisReferenceMappings.centreId, scopes.filter((scope): scope is string => scope !== null)) : eq(metropolisReferenceMappings.centreId, "00000000-0000-0000-0000-000000000000"));
  const rows = await getDb().select().from(metropolisReferenceMappings).where(and(...where)).orderBy(asc(metropolisReferenceMappings.createdAt)).limit(200);
  const centreWhere = [eq(centres.organizationId, access.staff.organizationId)];
  if (!scopes.includes(null)) centreWhere.push(scopes.length ? inArray(centres.id, scopes.filter((scope): scope is string => scope !== null)) : eq(centres.id, "00000000-0000-0000-0000-000000000000"));
  const authorizedCentres = await getDb().select({ id: centres.id, name: centres.name, code: centres.code }).from(centres).where(and(...centreWhere)).orderBy(asc(centres.name));
  const mappings = rows.map((row) => ({ id: row.id, centreId: row.centreId, orderId: row.orderId, specimenId: row.specimenId, referenceType: row.referenceType, recordedByStaffId: row.recordedByStaffId, createdAt: row.createdAt, ...decryptOperationalData<{ externalReference: string; evidenceReference: string; reason: string }>(row.privateDataCiphertext, operationalContext({ organizationId: row.organizationId, centreId: row.centreId, recordId: row.id }, "metropolis-reference")) }));
  return Response.json({ mappings, centres: authorizedCentres }, { headers: { "cache-control": "private, no-store" } });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  let body: unknown;
  try { body = await request.json(); } catch { return Response.json({ error: "invalid_json" }, { status: 400 }); }
  const parsed = metropolisReferenceSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: "invalid_metropolis_reference", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  if (!metropolisReferenceMatchesTarget(parsed.data.referenceType, parsed.data.specimenId)) return Response.json({ error: "specimen_reference_requires_specimen" }, { status: 400 });
  const idempotencyKey = request.headers.get("idempotency-key");
  if (!id.safeParse(idempotencyKey).success) return Response.json({ error: "valid_idempotency_key_required" }, { status: 400 });
  const access = await getApiAccess("samples.external.verify", parsed.data.centreId);
  if (access.response) return access.response;
  let referenceBlindIndex: string;
  try { referenceBlindIndex = blindIndexMetropolisReference(parsed.data.externalReference); }
  catch { return Response.json({ error: "reference_index_unavailable" }, { status: 503 }); }
  const db = getDb();
  try {
    const mapping = await db.transaction(async (tx) => {
      const lockKey = `rudra:metropolis-reference:${access.staff.organizationId}:${referenceBlindIndex}`;
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
      const [prior] = await tx.select().from(metropolisReferenceMappings).where(and(eq(metropolisReferenceMappings.organizationId, access.staff.organizationId), eq(metropolisReferenceMappings.idempotencyKey, idempotencyKey!))).limit(1);
      if (prior) {
        const existing = decryptOperationalData<{ externalReference: string; evidenceReference: string; reason: string }>(prior.privateDataCiphertext, operationalContext({ organizationId: prior.organizationId, centreId: prior.centreId, recordId: prior.id }, "metropolis-reference"));
        if (prior.recordedByStaffId !== access.staff.staffUserId || prior.centreId !== parsed.data.centreId || prior.orderId !== parsed.data.orderId || prior.specimenId !== (parsed.data.specimenId ?? null) || prior.referenceType !== parsed.data.referenceType || existing.externalReference !== parsed.data.externalReference || existing.evidenceReference !== parsed.data.evidenceReference || existing.reason !== parsed.data.reason) throw new Error("idempotency_conflict");
        return { id: prior.id, orderId: prior.orderId, specimenId: prior.specimenId, referenceType: prior.referenceType, replayed: true };
      }
      const [collision] = await tx.select({ id: metropolisReferenceMappings.id }).from(metropolisReferenceMappings).where(and(eq(metropolisReferenceMappings.organizationId, access.staff.organizationId), eq(metropolisReferenceMappings.referenceBlindIndex, referenceBlindIndex))).limit(1);
      if (collision) throw new Error("external_reference_collision");
      const [order] = await tx.select({ id: diagnosticOrders.id }).from(diagnosticOrders).where(and(eq(diagnosticOrders.id, parsed.data.orderId), eq(diagnosticOrders.organizationId, access.staff.organizationId), eq(diagnosticOrders.centreId, parsed.data.centreId))).limit(1);
      if (!order) throw new Error("order_not_found");
      if (parsed.data.specimenId) {
        const [specimen] = await tx.select({ id: specimens.id }).from(specimens).where(and(eq(specimens.id, parsed.data.specimenId), eq(specimens.organizationId, access.staff.organizationId), eq(specimens.centreId, parsed.data.centreId), eq(specimens.orderId, order.id))).limit(1);
        if (!specimen) throw new Error("specimen_not_found");
      }
      const id = randomUUID();
      const privateDataCiphertext = encryptOperationalData({ externalReference: parsed.data.externalReference, evidenceReference: parsed.data.evidenceReference, reason: parsed.data.reason }, operationalContext({ organizationId: access.staff.organizationId, centreId: parsed.data.centreId, recordId: id }, "metropolis-reference"));
      const [created] = await tx.insert(metropolisReferenceMappings).values({ id, organizationId: access.staff.organizationId, centreId: parsed.data.centreId, orderId: order.id, specimenId: parsed.data.specimenId ?? null, referenceType: parsed.data.referenceType, referenceBlindIndex, privateDataCiphertext, idempotencyKey: idempotencyKey!, recordedByStaffId: access.staff.staffUserId }).returning({ id: metropolisReferenceMappings.id, orderId: metropolisReferenceMappings.orderId, specimenId: metropolisReferenceMappings.specimenId, referenceType: metropolisReferenceMappings.referenceType });
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: parsed.data.centreId, actorStaffId: access.staff.staffUserId, action: "metropolis.reference_recorded", entityType: "diagnostic_order", entityId: order.id, details: { mappingId: id, referenceType: parsed.data.referenceType, source: "STAFF_RECORDED" } });
      return { ...created, replayed: false };
    });
    return Response.json({ mapping }, { status: mapping.replayed ? 200 : 201, headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (["external_reference_collision", "idempotency_conflict", "order_not_found", "specimen_not_found"].includes(code)) return Response.json({ error: code }, { status: code.endsWith("not_found") ? 404 : 409 });
    return Response.json({ error: "metropolis_reference_unavailable" }, { status: 409 });
  }
}
