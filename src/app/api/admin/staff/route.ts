import { and, eq, isNull } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { authAccount, authUser } from "@/db/auth-schema";
import { organizationSequences, roles, staffRoleAssignments, staffUsers } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { hasOrganizationPermission } from "@/server/staff-policy";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { randomUUID } from "node:crypto";
import { z } from "zod";
export async function GET() {
  const access = await getApiAccess("staff.read");
  if (access.response) return access.response;
  const db = getDb();
  const rows = await db.select({ id: staffUsers.id, staffCode: staffUsers.staffCode, displayName: staffUsers.displayName, status: staffUsers.status, isOwner: staffUsers.isOwner, twoFactorEnabled: authUser.twoFactorEnabled, centreId: staffRoleAssignments.centreId }).from(staffUsers).innerJoin(authUser, eq(authUser.id, staffUsers.authUserId)).leftJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), isNull(staffRoleAssignments.revokedAt))).leftJoin(roles, eq(roles.id, staffRoleAssignments.roleId)).where(eq(staffUsers.organizationId, access.staff.organizationId));
  const scope = access.staff.grants.filter((grant) => grant.key === "staff.read").map((grant) => grant.centreId);
  const data = scope.includes(null) ? rows : rows.filter((row) => row.id === access.staff.staffUserId || scope.includes(row.centreId));
  const uniqueStaff = new Map(data.map((row) => [row.id, { id: row.id, staffCode: row.staffCode, displayName: row.displayName, status: row.status, isOwner: row.isOwner, twoFactorEnabled: row.twoFactorEnabled }]));
  return Response.json({ staff: [...uniqueStaff.values()] });
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const access = await getApiAccess("staff.manage");
  if (access.response) return access.response;
  if (!hasOrganizationPermission(access.staff, "staff.manage")) return Response.json({ error: "forbidden" }, { status: 403 });
  const parsed = z.object({ displayName: z.string().trim().min(2).max(180), email: z.string().trim().email().max(254), password: z.string().min(12).max(128) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const email = parsed.data.email.toLowerCase();
  const passwordHash = await hashPassword(parsed.data.password);
  const db = getDb();
  try {
    const provisioned = await db.transaction(async (tx) => {
      const [existing] = await tx.select({ id: authUser.id }).from(authUser).where(eq(authUser.email, email)).limit(1);
      if (existing) throw new Error("identity_exists");
      const [sequence] = await tx.select({ next: organizationSequences.nextStaffNumber }).from(organizationSequences).where(eq(organizationSequences.organizationId, access.staff.organizationId)).for("update");
      if (!sequence) throw new Error("sequence_missing");
      const number = sequence.next;
      await tx.update(organizationSequences).set({ nextStaffNumber: number + 1, updatedAt: new Date() }).where(eq(organizationSequences.organizationId, access.staff.organizationId));
      const authId = randomUUID();
      const staffId = randomUUID();
      const staffCode = `RHC-STF-${String(number).padStart(6, "0")}`;
      await tx.insert(authUser).values({ id: authId, name: parsed.data.displayName, email, emailVerified: false });
      await tx.insert(authAccount).values({ id: randomUUID(), accountId: authId, providerId: "credential", userId: authId, password: passwordHash });
      await tx.insert(staffUsers).values({ id: staffId, authUserId: authId, organizationId: access.staff.organizationId, staffCode, displayName: parsed.data.displayName, status: "INVITED" });
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, actorStaffId: access.staff.staffUserId, action: "staff.provisioned", entityType: "staff_user", entityId: staffId, details: { staffCode, status: "INVITED", authentication: "password_totp_required" } });
      return { id: staffId, staffCode, displayName: parsed.data.displayName, status: "INVITED" as const };
    });
    return Response.json({ staff: provisioned }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "identity_exists") return Response.json({ error: "email_already_provisioned" }, { status: 409 });
    if (error instanceof Error && error.message === "sequence_missing") return Response.json({ error: "organization_sequence_unavailable" }, { status: 409 });
    return Response.json({ error: "staff_provisioning_unavailable" }, { status: 409 });
  }
}
