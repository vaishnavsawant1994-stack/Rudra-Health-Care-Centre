import { eq } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { organizations } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";

export async function GET() {
  const access = await getApiAccess("organization.read");
  if (access.response) return access.response;
  const [organization] = await getDb().select({ id: organizations.id, code: organizations.code, name: organizations.name, legalName: organizations.legalName, status: organizations.status }).from(organizations).where(eq(organizations.id, access.staff.organizationId)).limit(1);
  return Response.json({ organization: organization ?? null });
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const access = await getApiAccess("organization.manage");
  if (access.response) return access.response;
  const parsed = z.object({ name: z.string().trim().min(2).max(180), legalName: z.string().trim().max(240).nullable().optional() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const db = getDb();
  const updated = await db.transaction(async (tx) => {
    const [organization] = await tx.update(organizations).set({ name: parsed.data.name, legalName: parsed.data.legalName ?? null, updatedAt: new Date() }).where(eq(organizations.id, access.staff.organizationId)).returning({ id: organizations.id, name: organizations.name, legalName: organizations.legalName });
    await appendAuditEvent(tx, { organizationId: access.staff.organizationId, actorStaffId: access.staff.staffUserId, action: "organization.updated", entityType: "organization", entityId: organization.id, details: { fields: "name,legalName" } });
    return organization;
  });
  return Response.json({ organization: updated });
}
