import { headers } from "next/headers";
import { and, eq, isNull } from "drizzle-orm";
import { getAuth } from "@/lib/auth";
import { getPhaseOneEnvironment, getSetupStatus } from "@/lib/phase-one-config";
import { getDb } from "@/db/client";
import { authSession, authTwoFactor, authUser } from "@/db/auth-schema";
import { isMfaSessionAuthorized } from "@/server/mfa-policy";
import { centres, organizations, permissions, rolePermissions, roles, staffRoleAssignments, staffUsers } from "@/db/schema";
import { hasPermission, type PermissionGrant, type PermissionKey } from "@/server/permissions";

export type StaffContext = {
  staffUserId: string;
  authUserId: string;
  organizationId: string;
  staffCode: string;
  displayName: string;
  isOwner: boolean;
  grants: PermissionGrant[];
};

export type AccessResult =
  | { kind: "setup"; status: ReturnType<typeof getSetupStatus> }
  | { kind: "signed-out" }
  | { kind: "mfa-setup-required" }
  | { kind: "denied" }
  | { kind: "unavailable" }
  | { kind: "allowed"; staff: StaffContext };

export async function getAccess(permission?: PermissionKey, centreId?: string): Promise<AccessResult> {
  if (!getPhaseOneEnvironment()) return { kind: "setup", status: getSetupStatus() };
  try {
    const auth = getAuth();
    if (!auth) return { kind: "setup", status: getSetupStatus() };
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return { kind: "signed-out" };
    const db = getDb();
    const [authIdentity] = await db.select({ twoFactorEnabled: authUser.twoFactorEnabled, totpVerified: authTwoFactor.verified, mfaVerifiedAt: authSession.mfaVerifiedAt }).from(authUser).leftJoin(authTwoFactor, eq(authTwoFactor.userId, authUser.id)).innerJoin(authSession, eq(authSession.userId, authUser.id)).where(and(eq(authUser.id, session.user.id), eq(authSession.id, session.session.id))).limit(1);
    if (!authIdentity || !isMfaSessionAuthorized(authIdentity.twoFactorEnabled, authIdentity.totpVerified ?? false, authIdentity.mfaVerifiedAt)) return { kind: "mfa-setup-required" };
    const rows = await db.select({
      staffUserId: staffUsers.id,
      authUserId: staffUsers.authUserId,
      organizationId: staffUsers.organizationId,
      staffCode: staffUsers.staffCode,
      displayName: staffUsers.displayName,
      isOwner: staffUsers.isOwner,
      permission: permissions.key,
      centreId: staffRoleAssignments.centreId,
    })
      .from(staffUsers)
      .innerJoin(organizations, eq(organizations.id, staffUsers.organizationId))
      .leftJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), isNull(staffRoleAssignments.revokedAt)))
      .leftJoin(roles, eq(roles.id, staffRoleAssignments.roleId))
      .leftJoin(rolePermissions, eq(rolePermissions.roleId, roles.id))
      .leftJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
      .where(and(eq(staffUsers.authUserId, session.user.id), eq(staffUsers.status, "ACTIVE"), eq(organizations.status, "ACTIVE")));
    if (rows.length === 0) return { kind: "denied" };
    const first = rows[0];
    const staff: StaffContext = {
      staffUserId: first.staffUserId,
      authUserId: first.authUserId,
      organizationId: first.organizationId,
      staffCode: first.staffCode,
      displayName: first.displayName,
      isOwner: first.isOwner,
      grants: rows.filter((row): row is typeof row & { permission: string } => row.permission !== null)
        .map((row) => ({ key: row.permission, centreId: row.centreId })),
    };
    if (permission && !hasPermission(staff.grants, permission, centreId)) return { kind: "denied" };
    if (centreId) {
      const centre = await db.select({ id: centres.id }).from(centres)
        .where(and(eq(centres.id, centreId), eq(centres.organizationId, staff.organizationId), eq(centres.status, "ACTIVE"))).limit(1);
      if (centre.length === 0 || !hasPermission(staff.grants, permission ?? "centres.read", centreId)) return { kind: "denied" };
    }
    return { kind: "allowed", staff };
  } catch {
    return { kind: "unavailable" };
  }
}

export async function getApiAccess(permission: PermissionKey, centreId?: string) {
  const access = await getAccess(permission, centreId);
  if (access.kind === "allowed") return { staff: access.staff, response: null } as const;
  if (access.kind === "setup") return { staff: null, response: Response.json({ error: "setup_required", missing: access.status.missing, invalid: access.status.invalid }, { status: 503 }) } as const;
  if (access.kind === "signed-out") return { staff: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) } as const;
  if (access.kind === "mfa-setup-required") return { staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) } as const;
  if (access.kind === "denied") return { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) } as const;
  return { staff: null, response: Response.json({ error: "service_unavailable" }, { status: 503 }) } as const;
}
