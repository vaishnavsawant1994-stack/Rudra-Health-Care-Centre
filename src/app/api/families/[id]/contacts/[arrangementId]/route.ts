import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { encryptFamilyValue } from "@/server/family-crypto";
import { getDb } from "@/db/client";
import { families, familyContactArrangements, familyMembers } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { canAccessFamilyCentre } from "@/server/family-policy";
import { contactVerifySchema } from "../route";

type Context = { params: Promise<{ id: string; arrangementId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id, arrangementId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(arrangementId).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = contactVerifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_verification" }, { status: 400 });
  const access = await getApiAccess("families.members.verify");
  if (access.response) return access.response;
  const [arrangement] = await getDb().select({ id: familyContactArrangements.id, familyId: familyContactArrangements.familyId, patientId: familyContactArrangements.patientId, organizationId: familyContactArrangements.organizationId, centreId: familyContactArrangements.centreId, status: familyContactArrangements.status }).from(familyContactArrangements).where(and(eq(familyContactArrangements.id, arrangementId), eq(familyContactArrangements.familyId, id), eq(familyContactArrangements.organizationId, access.staff.organizationId))).limit(1);
  if (!arrangement || !canAccessFamilyCentre(access.staff.grants, "families.members.verify", arrangement.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!canAccessFamilyCentre(access.staff.grants, "patients.read", arrangement.centreId)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (arrangement.status !== "PENDING") return Response.json({ error: "arrangement_not_pending" }, { status: 409 });
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.select({ id: families.id }).from(families).where(and(eq(families.id, id), eq(families.organizationId, arrangement.organizationId))).for("update");
      const [member] = await tx.select({ id: familyMembers.id }).from(familyMembers).where(and(eq(familyMembers.familyId, id), eq(familyMembers.patientId, arrangement.patientId), eq(familyMembers.organizationId, arrangement.organizationId), eq(familyMembers.status, "ACTIVE"))).limit(1);
      if (!member) throw new Error("family_membership_changed");
      const [updated] = await tx.update(familyContactArrangements).set({ status: "VERIFIED", authorizationBasis: parsed.data.authorizationBasis, evidenceCiphertext: encryptFamilyValue("contact-evidence", parsed.data.evidenceReference, {organizationId:arrangement.organizationId,centreId:arrangement.centreId,recordId:arrangementId}), verifiedByStaffId: access.staff.staffUserId, verifiedAt: new Date() }).where(and(eq(familyContactArrangements.id, arrangementId), eq(familyContactArrangements.status, "PENDING"))).returning({ id: familyContactArrangements.id, status: familyContactArrangements.status });
      if (!updated) throw new Error("arrangement_state_changed");
      await appendAuditEvent(tx, { organizationId: arrangement.organizationId, centreId: arrangement.centreId, actorStaffId: access.staff.staffUserId, action: "family.contact.verified", entityType: "family", entityId: id, details: { arrangementId, status: "VERIFIED", authorizationBasis: parsed.data.authorizationBasis } });
      return updated;
    });
    return Response.json({ arrangement: result });
  } catch { return Response.json({ error: "arrangement_verification_unavailable" }, { status: 409 }); }
}

export async function DELETE(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id, arrangementId } = await params;
  if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(arrangementId).success) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("families.members.manage");
  if (access.response) return access.response;
  const [arrangement] = await getDb().select({ id: familyContactArrangements.id, organizationId: familyContactArrangements.organizationId, centreId: familyContactArrangements.centreId }).from(familyContactArrangements).where(and(eq(familyContactArrangements.id, arrangementId), eq(familyContactArrangements.familyId, id), eq(familyContactArrangements.organizationId, access.staff.organizationId))).limit(1);
  if (!arrangement || !canAccessFamilyCentre(access.staff.grants, "families.members.manage", arrangement.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  try {
    const result = await getDb().transaction(async (tx) => {
      const [updated] = await tx.update(familyContactArrangements).set({ status: "REVOKED", revokedByStaffId: access.staff.staffUserId, revokedAt: new Date() }).where(and(eq(familyContactArrangements.id, arrangementId), eq(familyContactArrangements.familyId, id), inArray(familyContactArrangements.status, ["PENDING", "VERIFIED"]))).returning({ id: familyContactArrangements.id, status: familyContactArrangements.status });
      if (!updated) throw new Error("arrangement_missing");
      await appendAuditEvent(tx, { organizationId: arrangement.organizationId, centreId: arrangement.centreId, actorStaffId: access.staff.staffUserId, action: "family.contact.revoked", entityType: "family", entityId: id, details: { arrangementId, status: "REVOKED" } });
      return updated;
    });
    return Response.json({ arrangement: result });
  } catch { return Response.json({ error: "arrangement_revocation_unavailable" }, { status: 409 }); }
}
