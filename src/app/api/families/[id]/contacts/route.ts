import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { getDb } from "@/db/client";
import { familyContactArrangements, familyMembers, families } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { canAccessFamilyCentre, familyAuthorizationBases } from "@/server/family-policy";

type Context = { params: Promise<{ id: string }> };
const schema = z.object({ patientId: z.uuid(), channel: z.enum(["PHONE", "EMAIL"]), purpose: z.enum(["GENERAL_FAMILY_CONTACT", "BOOKING_UPDATES", "APPOINTMENT_REMINDERS", "BILLING_NOTICES"]) });

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const access = await getApiAccess("families.members.manage");
  if (access.response) return access.response;
  const db = getDb();
  const [family] = await db.select({ id: families.id, organizationId: families.organizationId, centreId: families.centreId }).from(families).where(and(eq(families.id, id), eq(families.organizationId, access.staff.organizationId))).limit(1);
  if (!family || !canAccessFamilyCentre(access.staff.grants, "families.members.manage", family.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!canAccessFamilyCentre(access.staff.grants, "patients.read", family.centreId)) return Response.json({ error: "forbidden" }, { status: 403 });
  try {
    const arrangement = await db.transaction(async (tx) => {
      await tx.select({ id: families.id }).from(families).where(and(eq(families.id, id), eq(families.organizationId, family.organizationId))).for("update");
      const [member] = await tx.select({ id: familyMembers.id }).from(familyMembers).where(and(eq(familyMembers.familyId, id), eq(familyMembers.patientId, parsed.data.patientId), eq(familyMembers.organizationId, family.organizationId), eq(familyMembers.status, "ACTIVE"))).limit(1);
      if (!member) throw new Error("member_not_active");
      const [created] = await tx.insert(familyContactArrangements).values({ organizationId: family.organizationId, centreId: family.centreId, familyId: id, patientId: parsed.data.patientId, channel: parsed.data.channel, purpose: parsed.data.purpose, status: "PENDING", createdByStaffId: access.staff.staffUserId }).returning({ id: familyContactArrangements.id, channel: familyContactArrangements.channel, purpose: familyContactArrangements.purpose, status: familyContactArrangements.status });
      await appendAuditEvent(tx, { organizationId: family.organizationId, centreId: family.centreId, actorStaffId: access.staff.staffUserId, action: "family.contact.requested", entityType: "family", entityId: id, details: { arrangementId: created.id, status: "PENDING", channel: created.channel, purpose: created.purpose } });
      return created;
    });
    return Response.json({ arrangement }, { status: 201 });
  } catch { return Response.json({ error: "contact_arrangement_conflict_or_unavailable" }, { status: 409 }); }
}

export const contactVerifySchema = z.object({ verify: z.literal(true), authorizationBasis: z.enum(familyAuthorizationBases), evidenceReference: z.string().trim().min(3).max(200) });
