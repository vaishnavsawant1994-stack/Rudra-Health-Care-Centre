import { and, eq, gt } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { authSession } from "@/db/auth-schema";
import { staffUsers } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
export async function GET() {
  const access = await getApiAccess("sessions.read");
  if (access.response) return access.response;
  const data = await getDb().select({ id: authSession.id, userId: authSession.userId, expiresAt: authSession.expiresAt, createdAt: authSession.createdAt, staffCode: staffUsers.staffCode, displayName: staffUsers.displayName }).from(authSession).innerJoin(staffUsers, eq(staffUsers.authUserId, authSession.userId)).where(and(eq(staffUsers.organizationId, access.staff.organizationId), gt(authSession.expiresAt, new Date())));
  return Response.json({ sessions: data });
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const access = await getApiAccess("sessions.revoke");
  if (access.response) return access.response;
  const parsed = z.object({ sessionId: z.string().min(1).max(200) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const db = getDb();
  const result = await db.transaction(async (tx) => {
    const [session] = await tx.select({ id: authSession.id, userId: authSession.userId, staffId: staffUsers.id }).from(authSession).innerJoin(staffUsers, eq(staffUsers.authUserId, authSession.userId)).where(and(eq(authSession.id, parsed.data.sessionId), eq(staffUsers.organizationId, access.staff.organizationId))).limit(1);
    if (!session) return false;
    await tx.delete(authSession).where(eq(authSession.id, session.id));
    await appendAuditEvent(tx, { organizationId: access.staff.organizationId, actorStaffId: access.staff.staffUserId, action: "staff.session.revoked", entityType: "session", entityId: session.id, details: { targetStaffId: session.staffId } });
    return true;
  });
  return result ? Response.json({ revoked: true }) : Response.json({ error: "session_not_found" }, { status: 404 });
}
