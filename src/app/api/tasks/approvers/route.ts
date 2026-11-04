import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { getApiAccess } from "@/server/access";
import { filterTaskApproversWithReadAccess } from "@/server/staff-approval-policy";
import { permissions, rolePermissions, roles, staffApprovalPolicies, staffApprovalPolicyApprovers, staffRoleAssignments, staffUsers } from "@/db/schema";

export async function GET(request: Request) {
  const centreId = new URL(request.url).searchParams.get("centreId");
  if (!z.uuid().safeParse(centreId).success) return Response.json({ error: "invalid_centre" }, { status: 400 });
  const access = await getApiAccess("tasks.approve", centreId!);
  if (access.response) return access.response;
  const db = getDb();
  const [policy] = await db.select({ id: staffApprovalPolicies.id }).from(staffApprovalPolicies)
    .where(and(eq(staffApprovalPolicies.organizationId, access.staff.organizationId), eq(staffApprovalPolicies.actionType, "TASK_COMPLETION"), or(eq(staffApprovalPolicies.centreId, centreId!), isNull(staffApprovalPolicies.centreId))))
    .orderBy(sql`CASE WHEN ${staffApprovalPolicies.centreId} = ${centreId} THEN 0 ELSE 1 END`).limit(1);
  const named = policy ? await db.select({ staffId: staffApprovalPolicyApprovers.staffId }).from(staffApprovalPolicyApprovers)
    .where(and(eq(staffApprovalPolicyApprovers.organizationId, access.staff.organizationId), eq(staffApprovalPolicyApprovers.policyId, policy.id))) : [];
  const conditions = [eq(staffUsers.organizationId, access.staff.organizationId), eq(staffUsers.status, "ACTIVE"), or(eq(staffRoleAssignments.centreId, centreId!), isNull(staffRoleAssignments.centreId)), inArray(permissions.key, ["tasks.approve", "tasks.read"])];
  if (named.length) conditions.push(inArray(staffUsers.id, named.map((entry) => entry.staffId)));
  const rows = await db.selectDistinct({ id: staffUsers.id, displayName: staffUsers.displayName, staffCode: staffUsers.staffCode, permissionKey: permissions.key }).from(staffUsers)
    .innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, staffUsers.organizationId), isNull(staffRoleAssignments.revokedAt)))
    .innerJoin(roles, eq(roles.id, staffRoleAssignments.roleId)).innerJoin(rolePermissions, eq(rolePermissions.roleId, roles.id)).innerJoin(permissions, eq(permissions.id, rolePermissions.permissionId))
    .where(and(...conditions)).orderBy(staffUsers.displayName).limit(200);
  const allow = new Set(named.map((entry) => entry.staffId));
  const eligible = filterTaskApproversWithReadAccess(rows);
  return Response.json({ approvers: eligible.filter((row) => !allow.size || allow.has(row.id)).map(({ permissionKey: _permissionKey, ...row }) => row) });
}
