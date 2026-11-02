import { eq } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { auditEvents } from "@/db/schema";
export async function GET() {
  const access = await getApiAccess("audit.read");
  if (access.response) return access.response;
  const events = await getDb().select({ sequence: auditEvents.sequence, action: auditEvents.action, entityType: auditEvents.entityType, entityId: auditEvents.entityId, details: auditEvents.details, recordedAt: auditEvents.recordedAt }).from(auditEvents).where(eq(auditEvents.organizationId, access.staff.organizationId)).orderBy(auditEvents.sequence).limit(100);
  return Response.json({ events });
}
