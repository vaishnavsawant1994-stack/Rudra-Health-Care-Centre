import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { authSession, authUser } from "@/db/auth-schema";
import { getDb } from "@/db/client";
import { roles, staffRoleAssignments, staffUsers } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { hasOrganizationPermission } from "@/server/staff-policy";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await getApiAccess("staff.read");
  if (access.response) return access.response;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const db = getDb();
  const assignments = await db.select({ id: staffRoleAssignments.id, role: roles.name, roleKey: roles.key, centreId: staffRoleAssignments.centreId, revokedAt: staffRoleAssignments.revokedAt }).from(staffRoleAssignments).innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId)).where(and(eq(staffRoleAssignments.staffUserId, id), eq(staffRoleAssignments.organizationId, access.staff.organizationId)));
  const centreScope = access.staff.grants.filter((grant) => grant.key === "staff.read").map((grant) => grant.centreId);
  const [profile] = await db.select({ id: staffUsers.id, staffCode: staffUsers.staffCode, displayName: staffUsers.displayName, status: staffUsers.status, isOwner: staffUsers.isOwner, createdAt: staffUsers.createdAt, email: authUser.email, twoFactorEnabled: authUser.twoFactorEnabled }).from(staffUsers).innerJoin(authUser, eq(authUser.id, staffUsers.authUserId)).where(and(eq(staffUsers.id, id), eq(staffUsers.organizationId, access.staff.organizationId))).limit(1);
  if (!profile || (!centreScope.includes(null) && profile.id !== access.staff.staffUserId && !assignments.some((assignment) => assignment.centreId !== null && centreScope.includes(assignment.centreId)))) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ staff: profile, assignments: assignments.filter((assignment) => centreScope.includes(null) || (assignment.centreId !== null && centreScope.includes(assignment.centreId))) });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const access = await getApiAccess("staff.manage");
  if (access.response) return access.response;
  if (!hasOrganizationPermission(access.staff, "staff.manage")) return Response.json({ error: "forbidden" }, { status: 403 });
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = z.object({ displayName: z.string().trim().min(2).max(180).optional(), status: z.enum(["ACTIVE", "SUSPENDED", "REVOKED"]).optional() }).refine((value) => value.displayName !== undefined || value.status !== undefined).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  if (id === access.staff.staffUserId) return Response.json({ error: "self_update_not_allowed" }, { status: 409 });
  const db = getDb();
  try {
    const updated = await db.transaction(async (tx) => {
      const [target] = await tx.select({ id: staffUsers.id, authUserId: staffUsers.authUserId, isOwner: staffUsers.isOwner, status: staffUsers.status }).from(staffUsers).where(and(eq(staffUsers.id, id), eq(staffUsers.organizationId, access.staff.organizationId))).limit(1);
      if (!target) throw new Error("not_found");
      if (target.isOwner && !access.staff.isOwner) throw new Error("owner_change_denied");
      if (target.isOwner && parsed.data.status && parsed.data.status !== "ACTIVE") {
        const [{ activeOwners }] = await tx.select({ activeOwners: count() }).from(staffUsers).where(and(eq(staffUsers.organizationId, access.staff.organizationId), eq(staffUsers.isOwner, true), eq(staffUsers.status, "ACTIVE")));
        if (activeOwners <= 1) throw new Error("last_owner");
      }
      const [row] = await tx.update(staffUsers).set({ ...(parsed.data.displayName ? { displayName: parsed.data.displayName } : {}), ...(parsed.data.status ? { status: parsed.data.status } : {}), updatedAt: new Date() }).where(eq(staffUsers.id, id)).returning({ id: staffUsers.id, staffCode: staffUsers.staffCode, displayName: staffUsers.displayName, status: staffUsers.status });
      if (parsed.data.displayName) await tx.update(authUser).set({ name: parsed.data.displayName, updatedAt: new Date() }).where(eq(authUser.id, target.authUserId));
      let revokedSessions = 0;
      if (parsed.data.status && parsed.data.status !== "ACTIVE") {
        const sessions = await tx.delete(authSession).where(eq(authSession.userId, target.authUserId)).returning({ id: authSession.id });
        revokedSessions = sessions.length;
      }
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, actorStaffId: access.staff.staffUserId, action: "staff.profile.updated", entityType: "staff_user", entityId: id, details: { fields: Object.keys(parsed.data).join(","), ...(revokedSessions ? { revokedSessions } : {}) } });
      return row;
    });
    return Response.json({ staff: updated });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "not_found") return Response.json({ error: "not_found" }, { status: 404 });
    if (reason === "last_owner") return Response.json({ error: "cannot_deactivate_last_owner" }, { status: 409 });
    if (reason === "owner_change_denied") return Response.json({ error: "owner_change_not_authorized" }, { status: 403 });
    return Response.json({ error: "staff_update_unavailable" }, { status: 409 });
  }
}
