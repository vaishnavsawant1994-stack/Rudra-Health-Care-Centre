import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { encryptFamilyValue } from "@/server/family-crypto";
import { getDb } from "@/db/client";
import { families, familyAccessGrants, familyMembers } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { canAccessFamilyCentre, familyGrantVerifySchema } from "@/server/family-policy";

type Context = { params: Promise<{ id: string; grantId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id, grantId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(grantId).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = familyGrantVerifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_verification" }, { status: 400 });
  const access = await getApiAccess("families.sharing.verify");
  if (access.response) return access.response;
  const [grant] = await getDb().select({ id: familyAccessGrants.id, familyId: familyAccessGrants.familyId, organizationId: familyAccessGrants.organizationId, centreId: familyAccessGrants.centreId, patientId: familyAccessGrants.patientId, granteePatientId: familyAccessGrants.granteePatientId, status: familyAccessGrants.status, effectiveAt: familyAccessGrants.effectiveAt, expiresAt: familyAccessGrants.expiresAt }).from(familyAccessGrants).where(and(eq(familyAccessGrants.id, grantId), eq(familyAccessGrants.familyId, id), eq(familyAccessGrants.organizationId, access.staff.organizationId))).limit(1);
  if (!grant || !canAccessFamilyCentre(access.staff.grants, "families.sharing.verify", grant.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!canAccessFamilyCentre(access.staff.grants, "patients.read", grant.centreId)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (grant.status !== "PENDING_VERIFICATION") return Response.json({ error: "grant_not_pending" }, { status: 409 });
  if (grant.expiresAt && grant.expiresAt <= new Date()) return Response.json({ error: "grant_already_expired" }, { status: 409 });
  try {
    const [updated] = await getDb().transaction(async (tx) => {
      await tx.select({ id: families.id }).from(families).where(and(eq(families.id, id), eq(families.organizationId, grant.organizationId))).for("update");
      const members = await tx.select({ patientId: familyMembers.patientId }).from(familyMembers).where(and(eq(familyMembers.organizationId, grant.organizationId), eq(familyMembers.familyId, id), eq(familyMembers.status, "ACTIVE")));
      if (!members.some((member) => member.patientId === grant.patientId) || !members.some((member) => member.patientId === grant.granteePatientId)) throw new Error("family_membership_changed");
      const result = await tx.update(familyAccessGrants).set({ status: "ACTIVE", evidenceCiphertext: encryptFamilyValue("grant-evidence", parsed.data.evidenceReference, {organizationId:grant.organizationId,centreId:grant.centreId,recordId:grantId}), verifiedByStaffId: access.staff.staffUserId, verifiedAt: new Date() }).where(and(eq(familyAccessGrants.id, grantId), eq(familyAccessGrants.status, "PENDING_VERIFICATION"))).returning({ id: familyAccessGrants.id, status: familyAccessGrants.status, effectiveAt: familyAccessGrants.effectiveAt, expiresAt: familyAccessGrants.expiresAt });
      if (!result.length) throw new Error("grant_state_changed");
      await appendAuditEvent(tx, { organizationId: grant.organizationId, centreId: grant.centreId, actorStaffId: access.staff.staffUserId, action: "family.sharing.verified", entityType: "family", entityId: id, details: { grantId, status: "ACTIVE", effectiveAt: grant.effectiveAt.toISOString() } });
      return result;
    });
    return Response.json({ grant: updated });
  } catch { return Response.json({ error: "grant_verification_unavailable" }, { status: 409 }); }
}

export async function DELETE(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id, grantId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(grantId).success) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("families.sharing.manage");
  if (access.response) return access.response;
  const [grant] = await getDb().select({ id: familyAccessGrants.id, organizationId: familyAccessGrants.organizationId, centreId: familyAccessGrants.centreId }).from(familyAccessGrants).where(and(eq(familyAccessGrants.id, grantId), eq(familyAccessGrants.familyId, id), eq(familyAccessGrants.organizationId, access.staff.organizationId))).limit(1);
  if (!grant || !canAccessFamilyCentre(access.staff.grants, "families.sharing.manage", grant.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    const revoked = await getDb().transaction(async (tx) => {
      const [row] = await tx.update(familyAccessGrants).set({ status: "REVOKED", revokedByStaffId: access.staff.staffUserId, revokedAt: new Date() }).where(and(eq(familyAccessGrants.id, grantId), eq(familyAccessGrants.familyId, id), eq(familyAccessGrants.organizationId, grant.organizationId), inArray(familyAccessGrants.status, ["PENDING_VERIFICATION", "ACTIVE"]))).returning({ id: familyAccessGrants.id });
      if (!row) throw new Error("grant_not_active");
      await appendAuditEvent(tx, { organizationId: grant.organizationId, centreId: grant.centreId, actorStaffId: access.staff.staffUserId, action: "family.sharing.revoked", entityType: "family", entityId: id, details: { grantId, status: "REVOKED" } });
      return row;
    });
    return Response.json({ grant: revoked });
  } catch { return Response.json({ error: "grant_already_revoked_or_unavailable" }, { status: 409 }); }
}
