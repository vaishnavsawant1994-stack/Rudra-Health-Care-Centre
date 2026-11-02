import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getApiAccess } from "@/server/access";
import { parseRelationshipAttributionRange } from "@/server/relationship-attribution-range";

const filters = z.object({
  centreId: z.uuid(), type: z.enum(["DOCTOR", "CORPORATE", "PARTNER"]),
  from: z.string().optional(), to: z.string().optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(25),
});

type Row = { source_id: string; source_number: string; descriptor: string; status: string; lead_count: number; converted_count: number };
function rows<T>(result: unknown) { return (result as { rows?: T[] } | null | undefined)?.rows ?? []; }

export async function GET(request: Request) {
  const parsed = filters.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return Response.json({ error: "invalid_filters" }, { status: 400 });
  const range = parseRelationshipAttributionRange(parsed.data.from, parsed.data.to);
  if (!range) return Response.json({ error: "invalid_date_range" }, { status: 400 });

  const leadAccess = await getApiAccess("leads.read", parsed.data.centreId);
  if (leadAccess.response) return leadAccess.response;
  const relationPermission = parsed.data.type === "DOCTOR" ? "doctors.read" : parsed.data.type === "CORPORATE" ? "corporate.read" : "partners.read";
  const relationAccess = await getApiAccess(relationPermission, parsed.data.centreId);
  if (relationAccess.response || relationAccess.staff.organizationId !== leadAccess.staff.organizationId || relationAccess.staff.staffUserId !== leadAccess.staff.staffUserId) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  try {
    const { centreId, type, page, pageSize } = parsed.data;
    const offset = (page - 1) * pageSize;
    const dateConditions = sql`AND (${range.from}::timestamptz IS NULL OR l.created_at >= ${range.from}) AND (${range.toExclusive}::timestamptz IS NULL OR l.created_at < ${range.toExclusive})`;
    const result = type === "DOCTOR"
      ? await getDb().execute(sql`
          SELECT d.id AS source_id, d.doctor_number AS source_number, d.specialty AS descriptor, d.status,
            count(l.id)::int AS lead_count, count(lc.lead_id)::int AS converted_count
          FROM doctor_profiles d
          LEFT JOIN leads l ON l.organization_id=d.organization_id AND l.centre_id=d.centre_id AND l.source_doctor_id=d.id ${dateConditions}
          LEFT JOIN lead_conversions lc ON lc.lead_id=l.id AND lc.organization_id=l.organization_id AND lc.centre_id=l.centre_id
          WHERE d.organization_id=${leadAccess.staff.organizationId} AND d.centre_id=${centreId}
          GROUP BY d.id, d.doctor_number, d.specialty, d.status
          HAVING count(l.id)>0
          ORDER BY count(l.id) DESC, d.doctor_number ASC
          LIMIT ${pageSize + 1} OFFSET ${offset}`)
      : await getDb().execute(sql`
          SELECT r.id AS source_id, r.relationship_number AS source_number, r.category AS descriptor, r.status,
            count(l.id)::int AS lead_count, count(lc.lead_id)::int AS converted_count
          FROM business_relationships r
          LEFT JOIN leads l ON l.organization_id=r.organization_id AND l.centre_id=r.centre_id AND l.source_relationship_id=r.id AND l.source_relationship_type=${type} ${dateConditions}
          LEFT JOIN lead_conversions lc ON lc.lead_id=l.id AND lc.organization_id=l.organization_id AND lc.centre_id=l.centre_id
          WHERE r.organization_id=${leadAccess.staff.organizationId} AND r.centre_id=${centreId} AND r.relationship_type=${type}
          GROUP BY r.id, r.relationship_number, r.category, r.status
          HAVING count(l.id)>0
          ORDER BY count(l.id) DESC, r.relationship_number ASC
          LIMIT ${pageSize + 1} OFFSET ${offset}`);
    const found = rows<Row>(result);
    const referrals = found.slice(0, pageSize).map((row) => ({
      sourceId: row.source_id,
      sourceNumber: row.source_number,
      descriptor: row.descriptor,
      status: row.status,
      leads: row.lead_count,
      converted: row.converted_count,
    }));
    return Response.json({ referrals, page, pageSize, hasMore: found.length > pageSize }, { headers: { "cache-control": "private, no-store" } });
  } catch {
    return Response.json({ error: "referral_report_unavailable" }, { status: 503, headers: { "cache-control": "private, no-store" } });
  }
}
