import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { permissions, rolePermissions, roles } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { hasOrganizationPermission } from "@/server/staff-policy";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
export async function GET() {
  const access = await getApiAccess("roles.read");
  if (access.response) return access.response;
  const data = await getDb().select({ id: roles.id, role: roles.name, key: roles.key, scope: roles.scope, permission: permissions.key, description: permissions.description }).from(roles).leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id)).leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId)).where(eq(roles.organizationId, access.staff.organizationId));
  const catalog = await getDb().select({ key: permissions.key, description: permissions.description, scope: permissions.scope }).from(permissions);
  return Response.json({ roles: data, permissions: catalog });
}

export async function PATCH(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const access = await getApiAccess("roles.manage");
  if (access.response) return access.response;
  if (!access.staff.isOwner || !hasOrganizationPermission(access.staff, "roles.manage")) return Response.json({ error: "forbidden" }, { status: 403 });
  const parsed = z.object({ roleId: z.string().uuid(), permissionKeys: z.array(z.string().min(1).max(100)).max(100) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success || new Set(parsed.success ? parsed.data.permissionKeys : []).size !== (parsed.success ? parsed.data.permissionKeys.length : 0)) return Response.json({ error: "invalid_input" }, { status: 400 });
  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      const [role] = await tx.select({ id: roles.id, key: roles.key, scope: roles.scope }).from(roles).where(and(eq(roles.id, parsed.data.roleId), eq(roles.organizationId, access.staff.organizationId))).limit(1);
      if (!role || role.key === "owner_super_admin") throw new Error("immutable_role");
      const allRequested = await Promise.all(parsed.data.permissionKeys.map(async (key) => (await tx.select({ id: permissions.id, key: permissions.key, scope: permissions.scope }).from(permissions).where(eq(permissions.key, key)).limit(1))[0]));
      if (allRequested.some((grant) => !grant)) throw new Error("invalid_permissions");
      if (role.scope === "CENTRE" && allRequested.some((grant) => grant?.scope === "ORGANIZATION")) throw new Error("invalid_permissions");
      await tx.delete(rolePermissions).where(eq(rolePermissions.roleId, role.id));
      if (allRequested.length) await tx.insert(rolePermissions).values(allRequested.filter((grant): grant is NonNullable<typeof grant> => Boolean(grant)).map((grant) => ({ roleId: role.id, permissionId: grant.id })));
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, actorStaffId: access.staff.staffUserId, action: "role.permissions.updated", entityType: "role", entityId: role.id, details: { roleKey: role.key, permissionCount: allRequested.length } });
    });
    return Response.json({ updated: true });
  } catch (error) {
    if (error instanceof Error && error.message === "immutable_role") return Response.json({ error: "owner_role_is_immutable" }, { status: 409 });
    if (error instanceof Error && error.message === "invalid_permissions") return Response.json({ error: "invalid_permissions_for_role_scope" }, { status: 400 });
    return Response.json({ error: "role_update_unavailable" }, { status: 409 });
  }
}
