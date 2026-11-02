import { and, eq, inArray, isNull, or } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centres, roles, staffRoleAssignments, staffUsers } from "@/db/schema";
import { appointmentPermission, visibleAppointmentCentres } from "@/server/appointment-policy";

export async function getAppointmentReadAccess(centreId?: string) {
  const general = await getApiAccess("appointments.read", centreId);
  if (!general.response) return { staff: general.staff, assignedOnly: false, response: null } as const;
  if (general.response.status !== 403) return { staff: null, assignedOnly: false, response: general.response } as const;
  const assigned = await getApiAccess("appointments.assigned.read", centreId);
  if (assigned.response) return { staff: null, assignedOnly: false, response: assigned.response } as const;
  return { staff: assigned.staff, assignedOnly: true, response: null } as const;
}

export async function listAppointmentCentres(staff: NonNullable<Awaited<ReturnType<typeof getApiAccess>>["staff"]>, permission: "appointments.read" | "appointments.assigned.read" | "appointments.create" | "appointments.assign") {
  const scope = visibleAppointmentCentres(staff.grants, permission);
  if (scope !== null && !scope.length) return [];
  const conditions = [eq(centres.organizationId, staff.organizationId), eq(centres.status, "ACTIVE")];
  if (scope !== null) conditions.push(inArray(centres.id, scope));
  return getDb().select({ id: centres.id, code: centres.code, name: centres.name, timeZone: centres.timeZone }).from(centres).where(and(...conditions));
}

export function mayReadAppointmentAt(staff: { grants: Array<{ key: string; centreId: string | null }> }, centreId: string, assignedStaffId: string | null, staffId: string, assignedOnly: boolean) {
  return assignedOnly ? assignedStaffId === staffId && appointmentPermission(staff.grants, "appointments.assigned.read", centreId) : appointmentPermission(staff.grants, "appointments.read", centreId);
}

export async function listAssignableAppointmentStaff(organizationId: string, centreId: string) {
  return getDb().selectDistinct({ id: staffUsers.id, displayName: staffUsers.displayName, staffCode: staffUsers.staffCode })
    .from(staffUsers).innerJoin(staffRoleAssignments, and(eq(staffRoleAssignments.staffUserId, staffUsers.id), eq(staffRoleAssignments.organizationId, organizationId), isNull(staffRoleAssignments.revokedAt), or(eq(staffRoleAssignments.centreId, centreId), isNull(staffRoleAssignments.centreId))))
    .innerJoin(roles, and(eq(roles.id, staffRoleAssignments.roleId), eq(roles.organizationId, organizationId)))
    .innerJoin(centres, and(eq(centres.id, centreId), eq(centres.organizationId, organizationId), eq(centres.status, "ACTIVE")))
    .where(and(eq(staffUsers.organizationId, organizationId), eq(staffUsers.status, "ACTIVE"))).orderBy(staffUsers.displayName).limit(100);
}
