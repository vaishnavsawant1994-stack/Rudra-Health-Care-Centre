import { eq } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";

export async function GET() {
  const access = await getApiAccess("centres.read");
  if (access.response) return access.response;
  const db = getDb();
  const grants = access.staff.grants.filter((grant) => grant.key === "centres.read").map((grant) => grant.centreId);
  const rows = await db.select({ id: centres.id, code: centres.code, name: centres.name, timeZone: centres.timeZone, status: centres.status }).from(centres).where(eq(centres.organizationId, access.staff.organizationId));
  const scoped = grants.includes(null) ? rows : rows.filter((row) => grants.includes(row.id));
  return Response.json({ centres: scoped });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const access = await getApiAccess("centres.manage");
  if (access.response) return access.response;
  const parsed = z.object({ code: z.string().trim().regex(/^[A-Z0-9-]{2,32}$/), name: z.string().trim().min(2).max(180), timeZone: z.string().trim().min(3).max(64).nullable().transform((value) => value ?? "Asia/Kolkata").default("Asia/Kolkata") }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const db = getDb();
  try {
    const centre = await db.transaction(async (tx) => {
      const [created] = await tx.insert(centres).values({ organizationId: access.staff.organizationId, ...parsed.data }).returning({ id: centres.id, code: centres.code, name: centres.name });
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, actorStaffId: access.staff.staffUserId, action: "centre.created", entityType: "centre", entityId: created.id, details: { code: created.code } });
      return created;
    });
    return Response.json({ centre }, { status: 201 });
  } catch { return Response.json({ error: "centre_conflict_or_unavailable" }, { status: 409 }); }
}
