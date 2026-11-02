import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres, permissions, rolePermissions, roles, staffRoleAssignments, staffUsers } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { hasPermission, isRoleChangeAllowed } from "@/server/permissions";
import { permissionKeysAtScope } from "@/server/staff-policy";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";

const inputSchema = z.object({ staffUserId: z.string().uuid(), roleId: z.string().uuid(), centreId: z.string().uuid().nullable() });

export async function GET() {
  const access = await getApiAccess("assignments.read");
  if (access.response) return access.response;
  const db = getDb();
  const rows = await db.select({ id: staffRoleAssignments.id, staffUserId: staffUsers.id, staffCode: staffUsers.staffCode, staffName: staffUsers.displayName, staffStatus: staffUsers.status, isOwner: staffUsers.isOwner, roleId: roles.id, role: roles.name, roleKey: roles.key, centreId: centres.id, centre: centres.name, assignedAt: staffRoleAssignments.createdAt, revokedAt: staffRoleAssignments.revokedAt }).from(staffRoleAssignments).innerJoin(staffUsers, eq(staffUsers.id, staffRoleAssignments.staffUserId)).innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId)).leftJoin(centres, eq(centres.id, staffRoleAssignments.centreId)).where(eq(staffRoleAssignments.organizationId, access.staff.organizationId));
  const scope = access.staff.grants.filter((grant) => grant.key === "assignments.read").map((grant) => grant.centreId);
  return Response.json({ assignments: rows.filter((row) => scope.includes(null) || (row.centreId !== null && scope.includes(row.centreId))) });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const access = await getApiAccess("assignments.manage");
  if (access.response) return access.response;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const canManageScope = parsed.data.centreId
    ? hasPermission(access.staff.grants, "assignments.manage", parsed.data.centreId)
    : access.staff.grants.some((grant) => grant.key === "assignments.manage" && grant.centreId === null);
  if (!canManageScope) return Response.json({ error: "forbidden" }, { status: 403 });
  const db = getDb();
  try {
    const result = await db.transaction(async (tx) => {
      const [target] = await tx.select({ id: staffUsers.id, isOwner: staffUsers.isOwner }).from(staffUsers).where(and(eq(staffUsers.id, parsed.data.staffUserId), eq(staffUsers.organizationId, access.staff.organizationId))).limit(1);
      const [role] = await tx.select({ id: roles.id, key: roles.key, scope: roles.scope, isSystem: roles.isSystem }).from(roles).where(and(eq(roles.id, parsed.data.roleId), eq(roles.organizationId, access.staff.organizationId))).limit(1);
      if (!target || !role || (role.scope === "CENTRE" && !parsed.data.centreId) || (role.scope === "ORGANIZATION" && parsed.data.centreId) || (role.key === "owner_super_admin" && (!access.staff.isOwner || !target.isOwner))) throw new Error("invalid_scope");
      const rolePerms = await tx.select({ key: permissions.key }).from(permissions).innerJoin(rolePermissions, eq(rolePermissions.permissionId, permissions.id)).where(eq(rolePermissions.roleId, role.id));
      const keys = rolePerms.map((p) => p.key);
      if (!isRoleChangeAllowed({ isOwner: access.staff.isOwner, permissions: permissionKeysAtScope(access.staff, parsed.data.centreId) }, { isOwner: target.isOwner }, keys)) throw new Error("role_escalation_denied");
      if (parsed.data.centreId) {
        const [centre] = await tx.select({ id: centres.id }).from(centres).where(and(eq(centres.id, parsed.data.centreId), eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"))).limit(1);
        if (!centre) throw new Error("invalid_scope");
      }
      const [existing] = await tx.select({ id: staffRoleAssignments.id }).from(staffRoleAssignments).where(and(eq(staffRoleAssignments.staffUserId, target.id), eq(staffRoleAssignments.roleId, role.id), parsed.data.centreId ? eq(staffRoleAssignments.centreId, parsed.data.centreId) : isNull(staffRoleAssignments.centreId), isNull(staffRoleAssignments.revokedAt))).limit(1);
      if (existing) throw new Error("assignment_exists");
      const [assignment] = await tx.insert(staffRoleAssignments).values({ organizationId: access.staff.organizationId, staffUserId: target.id, roleId: role.id, centreId: parsed.data.centreId, assignedByStaffId: access.staff.staffUserId }).returning({ id: staffRoleAssignments.id });
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: parsed.data.centreId, actorStaffId: access.staff.staffUserId, action: "staff.role.assigned", entityType: "staff_role_assignment", entityId: assignment.id, details: { role: role.key, grantCount: keys.length } });
      return assignment;
    });
    return Response.json({ assignment: result }, { status: 201 });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "";
    if (reason === "role_escalation_denied") return Response.json({ error: "role_change_not_authorized" }, { status: 403 });
    if (reason === "invalid_scope") return Response.json({ error: "invalid_role_or_centre_scope" }, { status: 400 });
    if (reason === "assignment_exists") return Response.json({ error: "assignment_already_active" }, { status: 409 });
    return Response.json({ error: "assignment_unavailable" }, { status: 409 });
  }
}

export async function DELETE(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const access = await getApiAccess("assignments.manage");
  if (access.response) return access.response;
  const parsed = z.object({ assignmentId: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      const [assignment] = await tx.select({ id: staffRoleAssignments.id, staffUserId: staffRoleAssignments.staffUserId, roleId: roles.id, roleKey: roles.key, targetOwner: staffUsers.isOwner, centreId: staffRoleAssignments.centreId }).from(staffRoleAssignments).innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId)).innerJoin(staffUsers, eq(staffUsers.id, staffRoleAssignments.staffUserId)).where(and(eq(staffRoleAssignments.id, parsed.data.assignmentId), eq(staffRoleAssignments.organizationId, access.staff.organizationId), isNull(staffRoleAssignments.revokedAt))).limit(1);
      if (!assignment || (assignment.targetOwner && !access.staff.isOwner)) throw new Error("denied");
      if (assignment.roleKey === "owner_super_admin") throw new Error("owner_role_immutable");
      const canManageScope = assignment.centreId
        ? hasPermission(access.staff.grants, "assignments.manage", assignment.centreId)
        : access.staff.grants.some((grant) => grant.key === "assignments.manage" && grant.centreId === null);
      if (!canManageScope) throw new Error("denied");
      const rolePerms = await tx.select({ key: permissions.key }).from(permissions).innerJoin(rolePermissions, eq(rolePermissions.permissionId, permissions.id)).where(eq(rolePermissions.roleId, assignment.roleId));
      if (!isRoleChangeAllowed({ isOwner: access.staff.isOwner, permissions: permissionKeysAtScope(access.staff, assignment.centreId) }, { isOwner: assignment.targetOwner }, rolePerms.map((permission) => permission.key))) throw new Error("denied");
      await tx.update(staffRoleAssignments).set({ revokedAt: new Date() }).where(eq(staffRoleAssignments.id, assignment.id));
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: assignment.centreId, actorStaffId: access.staff.staffUserId, action: "staff.role.revoked", entityType: "staff_role_assignment", entityId: assignment.id, details: { role: assignment.roleKey } });
    });
    return Response.json({ revoked: true });
  } catch (error) { if (error instanceof Error && error.message === "owner_role_immutable") return Response.json({ error: "owner_role_assignment_is_immutable" }, { status: 409 }); return Response.json({ error: "assignment_not_revoked" }, { status: 403 }); }
}
