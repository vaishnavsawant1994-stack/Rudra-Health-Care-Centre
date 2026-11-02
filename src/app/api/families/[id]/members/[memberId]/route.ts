import { and, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { encryptFamilyValue } from "@/server/family-crypto";
import { getDb } from "@/db/client";
import { familyAccessGrants, familyContactArrangements, familyMembers, families } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { canAccessFamilyCentre, familyMemberUpdateSchema } from "@/server/family-policy";

type Context = { params: Promise<{ id: string; memberId: string }> };

async function familyAndMember(familyId: string, memberId: string, organizationId: string) {
  const [row] = await getDb().select({ familyId: families.id, organizationId: families.organizationId, centreId: families.centreId, primaryContactPatientId: families.primaryContactPatientId, memberId: familyMembers.id, patientId: familyMembers.patientId, relationship: familyMembers.relationship, status: familyMembers.status })
    .from(families).innerJoin(familyMembers, and(eq(familyMembers.familyId, families.id), eq(familyMembers.organizationId, families.organizationId), eq(familyMembers.centreId, families.centreId)))
    .where(and(eq(families.id, familyId), eq(families.organizationId, organizationId), eq(familyMembers.id, memberId))).limit(1);
  return row;
}

export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id, memberId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(memberId).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = familyMemberUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const access = await getApiAccess(parsed.data.verify ? "families.members.verify" : "families.members.manage");
  if (access.response) return access.response;
  const row = await familyAndMember(id, memberId, access.staff.organizationId);
  if (!row || !canAccessFamilyCentre(access.staff.grants, parsed.data.verify ? "families.members.verify" : "families.members.manage", row.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!canAccessFamilyCentre(access.staff.grants, "patients.read", row.centreId)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (row.status === "ENDED") return Response.json({ error: "membership_ended" }, { status: 409 });
  if (parsed.data.relationship === "SELF" && row.patientId !== row.primaryContactPatientId) return Response.json({ error: "self_relationship_invalid" }, { status: 409 });
  if (parsed.data.verify && row.status === "ACTIVE" && parsed.data.relationship === undefined) return Response.json({ error: "membership_already_verified" }, { status: 409 });
  const db = getDb();
  try {
    const result = await db.transaction(async (tx) => {
      await tx.select({ id: families.id }).from(families).where(and(eq(families.id, id), eq(families.organizationId, row.organizationId))).for("update");
      const fields = parsed.data.relationship !== undefined ? { relationship: parsed.data.relationship } : {};
      if (parsed.data.verify) {
        const [verified] = await tx.update(familyMembers).set({ ...fields, status: "ACTIVE", authorizationBasis: parsed.data.authorizationBasis!, evidenceCiphertext: encryptFamilyValue("member-evidence", parsed.data.evidenceReference!, {organizationId:row.organizationId,centreId:row.centreId,recordId:memberId}), verifiedByStaffId: access.staff.staffUserId, verifiedAt: new Date(), updatedAt: new Date() }).where(and(eq(familyMembers.id, memberId), eq(familyMembers.familyId, id), inArray(familyMembers.status, ["PENDING_VERIFICATION", "ACTIVE"]))).returning({ id: familyMembers.id, patientId: familyMembers.patientId, relationship: familyMembers.relationship, status: familyMembers.status });
        if (!verified) throw new Error("membership_state_changed");
        await appendAuditEvent(tx, { organizationId: row.organizationId, centreId: row.centreId, actorStaffId: access.staff.staffUserId, action: "family.member.verified", entityType: "family", entityId: id, details: { membershipId: memberId, authorizationBasis: parsed.data.authorizationBasis! } });
        return verified;
      }
      const changedRelationship = parsed.data.relationship !== undefined && parsed.data.relationship !== row.relationship;
      const [updated] = await tx.update(familyMembers).set({ ...fields, ...(changedRelationship && row.status === "ACTIVE" ? { status: "PENDING_VERIFICATION", authorizationBasis: null, evidenceCiphertext: null, verifiedByStaffId: null, verifiedAt: null } : {}), updatedAt: new Date() }).where(and(eq(familyMembers.id, memberId), eq(familyMembers.familyId, id))).returning({ id: familyMembers.id, patientId: familyMembers.patientId, relationship: familyMembers.relationship, status: familyMembers.status });
      await appendAuditEvent(tx, { organizationId: row.organizationId, centreId: row.centreId, actorStaffId: access.staff.staffUserId, action: "family.member.relationship_updated", entityType: "family", entityId: id, details: { membershipId: memberId, status: updated.status } });
      return updated;
    });
    return Response.json({ member: result });
  } catch { return Response.json({ error: "membership_update_unavailable" }, { status: 409 }); }
}

export async function DELETE(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id, memberId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(memberId).success) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("families.members.manage");
  if (access.response) return access.response;
  const row = await familyAndMember(id, memberId, access.staff.organizationId);
  if (!row || !canAccessFamilyCentre(access.staff.grants, "families.members.manage", row.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (row.status === "ENDED") return Response.json({ error: "membership_ended" }, { status: 409 });
  const db = getDb();
  try {
    await db.transaction(async (tx) => {
      await tx.select({ id: families.id }).from(families).where(and(eq(families.id, id), eq(families.organizationId, row.organizationId))).for("update");
      await tx.update(familyMembers).set({ status: "ENDED", endedByStaffId: access.staff.staffUserId, endedAt: new Date(), updatedAt: new Date() }).where(and(eq(familyMembers.id, memberId), eq(familyMembers.familyId, id)));
      if (row.primaryContactPatientId === row.patientId) await tx.update(families).set({ primaryContactPatientId: null, updatedAt: new Date() }).where(eq(families.id, id));
      await tx.update(familyAccessGrants).set({ status: "REVOKED", revokedByStaffId: access.staff.staffUserId, revokedAt: new Date() }).where(and(eq(familyAccessGrants.familyId, id), eq(familyAccessGrants.organizationId, row.organizationId), inArray(familyAccessGrants.status, ["PENDING_VERIFICATION", "ACTIVE"]), or(eq(familyAccessGrants.patientId, row.patientId), eq(familyAccessGrants.granteePatientId, row.patientId))));
      await tx.update(familyContactArrangements).set({ status: "REVOKED", revokedByStaffId: access.staff.staffUserId, revokedAt: new Date() }).where(and(eq(familyContactArrangements.familyId, id), eq(familyContactArrangements.organizationId, row.organizationId), eq(familyContactArrangements.patientId, row.patientId), inArray(familyContactArrangements.status, ["PENDING", "VERIFIED"])));
      await appendAuditEvent(tx, { organizationId: row.organizationId, centreId: row.centreId, actorStaffId: access.staff.staffUserId, action: "family.member.ended", entityType: "family", entityId: id, details: { membershipId: memberId, relatedGrantsRevoked: true } });
    });
    return Response.json({ ended: true });
  } catch { return Response.json({ error: "membership_end_unavailable" }, { status: 409 }); }
}
