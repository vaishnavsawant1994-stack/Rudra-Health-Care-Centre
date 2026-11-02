import { createHash, randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { openDoctorData, sealDoctorData, sealDoctorEvent, type DoctorPrivateData } from "@/server/doctor-data";
import { fingerprintOperationalRequest, operationalContext, verifyOperationalRequestFingerprint } from "@/server/operational-crypto";
import { hasPermission } from "@/server/permissions";
import { parseRelationshipAttributionRange } from "@/server/relationship-attribution-range";

const filters = z.object({ centreId: z.uuid(), status: z.enum(["ACTIVE", "INACTIVE"]).optional(), specialty: z.string().trim().max(100).optional(), purpose: z.enum(["PROFILE", "ATTRIBUTION"]).default("PROFILE"), attributionFrom: z.string().optional(), attributionTo: z.string().optional(), page: z.coerce.number().int().min(1).max(10000).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(25) });
const createSchema = z.object({ centreId: z.uuid(), name: z.string().trim().min(2).max(160), specialty: z.string().trim().min(2).max(100), phone: z.string().trim().min(7).max(32).nullable().optional(), email: z.email().max(254).nullable().optional(), registrationReference: z.string().trim().max(100).nullable().optional(), affiliation: z.string().trim().max(180).nullable().optional(), notes: z.string().trim().max(1000).nullable().optional() }).strict();
type Profile = { id: string; organization_id: string; centre_id: string; doctor_number: string; specialty: string; status: "ACTIVE" | "INACTIVE"; private_data_ciphertext: string; version_number: number; created_at: Date; updated_at: Date };
function rows<T>(result: unknown) { return (result as { rows?: T[] }).rows ?? []; }
function serialize(row: Profile) { return { id: row.id, centreId: row.centre_id, doctorNumber: row.doctor_number, specialty: row.specialty, status: row.status, ...openDoctorData({ organizationId: row.organization_id, centreId: row.centre_id, id: row.id }, row.private_data_ciphertext), version: row.version_number, createdAt: new Date(row.created_at).toISOString(), updatedAt: new Date(row.updated_at).toISOString() }; }

export async function GET(request: Request) {
  const parsed = filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const attributionRange = parseRelationshipAttributionRange(parsed.data.attributionFrom, parsed.data.attributionTo);
  if (!attributionRange) return Response.json({ error: "invalid_attribution_date_range" }, { status: 400 });
  const access = await getApiAccess("doctors.read", parsed.data.centreId);
  if (access.response) return access.response;
  try {
    if (parsed.data.purpose === "ATTRIBUTION") {
      const result = await getDb().execute(sql`SELECT id, centre_id, doctor_number, specialty, status FROM doctor_profiles WHERE organization_id = ${access.staff.organizationId} AND centre_id = ${parsed.data.centreId} AND status = 'ACTIVE' ORDER BY specialty, doctor_number LIMIT ${parsed.data.pageSize + 1} OFFSET ${(parsed.data.page - 1) * parsed.data.pageSize}`);
      const found = rows<{ id: string; centre_id: string; doctor_number: string; specialty: string; status: string }>(result);
      return Response.json({ doctors: found.slice(0, parsed.data.pageSize).map((row) => ({ id: row.id, centreId: row.centre_id, doctorNumber: row.doctor_number, specialty: row.specialty, status: row.status })), page: parsed.data.page, pageSize: parsed.data.pageSize, hasMore: found.length > parsed.data.pageSize });
    }
    const result = await getDb().execute(sql`SELECT id, organization_id, centre_id, doctor_number, specialty, status, private_data_ciphertext, version_number, created_at, updated_at FROM doctor_profiles WHERE organization_id = ${access.staff.organizationId} AND centre_id = ${parsed.data.centreId} AND (${parsed.data.status ?? null}::text IS NULL OR status = ${parsed.data.status ?? null}) AND (${parsed.data.specialty ?? null}::text IS NULL OR specialty ILIKE ${parsed.data.specialty ? `%${parsed.data.specialty}%` : null}) ORDER BY specialty, doctor_number LIMIT ${parsed.data.pageSize + 1} OFFSET ${(parsed.data.page - 1) * parsed.data.pageSize}`);
    const found = rows<Profile>(result);
    const pageRows = found.slice(0, parsed.data.pageSize);
    let attributed = new Map<string, { leads: number; converted: number }>();
    if (hasPermission(access.staff.grants, "leads.read", parsed.data.centreId) && pageRows.length) {
      const ids = pageRows.map((row) => row.id);
      const metrics = rows<{ source_doctor_id: string; lead_count: number; converted_count: number }>(await getDb().execute(sql`
        SELECT l.source_doctor_id,
          count(*)::int AS lead_count,
          count(lc.lead_id)::int AS converted_count
        FROM leads l
        LEFT JOIN lead_conversions lc
          ON lc.lead_id=l.id AND lc.organization_id=l.organization_id AND lc.centre_id=l.centre_id
        WHERE l.organization_id=${access.staff.organizationId} AND l.centre_id=${parsed.data.centreId}
          AND l.source_doctor_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
          AND (${attributionRange.from}::timestamptz IS NULL OR l.created_at >= ${attributionRange.from})
          AND (${attributionRange.toExclusive}::timestamptz IS NULL OR l.created_at < ${attributionRange.toExclusive})
        GROUP BY l.source_doctor_id`));
      attributed = new Map(metrics.map((row) => [row.source_doctor_id, { leads: row.lead_count, converted: row.converted_count }]));
    }
    return Response.json({ doctors: pageRows.map((row) => ({ ...serialize(row), ...(hasPermission(access.staff.grants, "leads.read", parsed.data.centreId) ? { attribution: attributed.get(row.id) ?? { leads: 0, converted: 0 } } : {}) })), page: parsed.data.page, pageSize: parsed.data.pageSize, hasMore: found.length > parsed.data.pageSize });
  } catch { return Response.json({ error: "doctor_directory_unavailable" }, { status: 503 }); }
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const body = createSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return Response.json({ error: "invalid_doctor_profile" }, { status: 400 });
  const access = await getApiAccess("doctors.manage", body.data.centreId);
  if (access.response) return access.response;
  const key = request.headers.get("idempotency-key");
  if (!key || !z.uuid().safeParse(key).success) return Response.json({ error: "idempotency_key_required" }, { status: 400 });
  const normalized: DoctorPrivateData = { name: body.data.name, phone: body.data.phone || null, email: body.data.email?.toLowerCase() || null, registrationReference: body.data.registrationReference || null, affiliation: body.data.affiliation || null, notes: body.data.notes || null };
  const requestPayload = { ...body.data, email: normalized.email, actorStaffId: access.staff.staffUserId };
  const requestContext = operationalContext({ organizationId: access.staff.organizationId, centreId: body.data.centreId, recordId: key }, "doctor-create-idempotency");
  const requestHash = fingerprintOperationalRequest(requestPayload, requestContext);
  const legacyRequestHash = createHash("sha256").update(JSON.stringify({ ...body.data, email: normalized.email })).digest("hex");
  const db = getDb();
  try {
    let replayed = false;
    const created = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${access.staff.organizationId}:doctor:${key}`}, 0))`);
      const prior = rows<{ doctor_id: string; request_hash: string; actor_staff_id: string }>(await tx.execute(sql`SELECT doctor_id, request_hash, actor_staff_id FROM doctor_relationship_events WHERE organization_id = ${access.staff.organizationId} AND idempotency_key = ${key} LIMIT 1`))[0];
      if (prior) {
        if (prior.actor_staff_id !== access.staff.staffUserId || (!verifyOperationalRequestFingerprint(requestPayload, prior.request_hash, requestContext) && prior.request_hash !== legacyRequestHash)) throw new Error("idempotency_conflict");
        const replay = rows<Profile>(await tx.execute(sql`SELECT id, organization_id, centre_id, doctor_number, specialty, status, private_data_ciphertext, version_number, created_at, updated_at FROM doctor_profiles WHERE id = ${prior.doctor_id} AND organization_id = ${access.staff.organizationId} AND centre_id = ${body.data.centreId}`))[0];
        if (!replay) throw new Error("idempotency_scope_conflict");
        replayed = true;
        return replay;
      }
      const id = randomUUID();
      const number = `RHC-D-${new Date().getFullYear()}-${id.slice(0, 8).toUpperCase()}`;
      const cipher = sealDoctorData({ organizationId: access.staff.organizationId, centreId: body.data.centreId, id }, normalized);
      const inserted = rows<Profile>(await tx.execute(sql`INSERT INTO doctor_profiles (id, organization_id, centre_id, doctor_number, specialty, private_data_ciphertext, created_by_staff_id, updated_by_staff_id) VALUES (${id}, ${access.staff.organizationId}, ${body.data.centreId}, ${number}, ${body.data.specialty}, ${cipher}, ${access.staff.staffUserId}, ${access.staff.staffUserId}) RETURNING id, organization_id, centre_id, doctor_number, specialty, status, private_data_ciphertext, version_number, created_at, updated_at`))[0];
      if (!inserted) throw new Error("doctor_insert_failed");
      const eventId = randomUUID();
      const eventCipher = sealDoctorEvent({ organizationId: access.staff.organizationId, centreId: body.data.centreId, id: eventId }, { version: 1 });
      await tx.execute(sql`INSERT INTO doctor_relationship_events (id, organization_id, centre_id, doctor_id, event_type, private_data_ciphertext, actor_staff_id, idempotency_key, request_hash) VALUES (${eventId}, ${access.staff.organizationId}, ${body.data.centreId}, ${id}, 'CREATED', ${eventCipher}, ${access.staff.staffUserId}, ${key}, ${requestHash})`);
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: body.data.centreId, actorStaffId: access.staff.staffUserId, action: "doctor_profile.created", entityType: "doctor_profile", entityId: id, details: { specialty: body.data.specialty } });
      return inserted;
    });
    return Response.json({ doctor: serialize(created), replayed }, { status: replayed ? 200 : 201 });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("idempotency_")) return Response.json({ error: error.message }, { status: 409 });
    return Response.json({ error: "doctor_profile_creation_unavailable" }, { status: 409 });
  }
}
