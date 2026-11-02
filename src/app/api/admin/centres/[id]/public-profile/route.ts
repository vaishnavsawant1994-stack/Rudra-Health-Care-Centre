import { and, eq } from "drizzle-orm";
import { getApiAccess } from "@/server/access";
import { getDb } from "@/db/client";
import { centrePublicProfiles, centres } from "@/db/schema";
import { appendAuditEvent } from "@/server/audit";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { centrePublicProfileSchema, decryptCentrePublicProfile, encryptCentrePublicProfile } from "@/server/centre-public-profile";
import { z } from "zod";

type RouteContext = { params: Promise<{ id: string }> };
const idSchema = z.string().uuid();

export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("centres.manage", id);
  if (access.response) return access.response;
  const [row] = await getDb().select({ ciphertext: centrePublicProfiles.profileCiphertext, published: centrePublicProfiles.published, versionNumber: centrePublicProfiles.versionNumber })
    .from(centrePublicProfiles).innerJoin(centres, and(eq(centres.id, centrePublicProfiles.centreId), eq(centres.organizationId, centrePublicProfiles.organizationId)))
    .where(and(eq(centrePublicProfiles.organizationId, access.staff.organizationId), eq(centrePublicProfiles.centreId, id), eq(centres.status, "ACTIVE"))).limit(1);
  if (!row) return Response.json({ profile: null, versionNumber: 0 });
  try { return Response.json({ profile: decryptCentrePublicProfile(row.ciphertext, access.staff.organizationId, id), versionNumber: row.versionNumber }); }
  catch { return Response.json({ error: "profile_unavailable" }, { status: 503 }); }
}

export async function PUT(request: Request, context: RouteContext) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await context.params;
  if (!idSchema.safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const access = await getApiAccess("centres.manage", id);
  if (access.response) return access.response;
  const parsed = z.object({ expectedVersion: z.number().int().nonnegative(), profile: centrePublicProfileSchema }).strict().safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_profile" }, { status: 400 });
  const db = getDb();
  try {
    const saved = await db.transaction(async (tx) => {
      const [centre] = await tx.select({ id: centres.id }).from(centres).where(and(eq(centres.id, id), eq(centres.organizationId, access.staff.organizationId), eq(centres.status, "ACTIVE"))).for("update").limit(1);
      if (!centre) return { kind: "missing" as const };
      const [current] = await tx.select({ id: centrePublicProfiles.id, versionNumber: centrePublicProfiles.versionNumber })
        .from(centrePublicProfiles).where(and(eq(centrePublicProfiles.organizationId, access.staff.organizationId), eq(centrePublicProfiles.centreId, id))).for("update").limit(1);
      const expected = current?.versionNumber ?? 0;
      if (expected !== parsed.data.expectedVersion) return { kind: "conflict" as const };
      const ciphertext = encryptCentrePublicProfile(parsed.data.profile, access.staff.organizationId, id);
      const nextVersion = expected + 1;
      if (current) await tx.update(centrePublicProfiles).set({ profileCiphertext: ciphertext, published: parsed.data.profile.published, versionNumber: nextVersion, updatedByStaffId: access.staff.staffUserId, updatedAt: new Date() }).where(eq(centrePublicProfiles.id, current.id));
      else await tx.insert(centrePublicProfiles).values({ organizationId: access.staff.organizationId, centreId: id, profileCiphertext: ciphertext, published: parsed.data.profile.published, versionNumber: nextVersion, createdByStaffId: access.staff.staffUserId, updatedByStaffId: access.staff.staffUserId });
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: id, actorStaffId: access.staff.staffUserId, action: "centre.public_profile.saved", entityType: "centre_public_profile", entityId: id, details: { published: parsed.data.profile.published, versionNumber: nextVersion, fieldsPresent: Object.entries(parsed.data.profile).filter(([key, value]) => key !== "published" && value !== null).map(([key]) => key) } });
      return { kind: "saved" as const, versionNumber: nextVersion };
    });
    if (saved.kind === "missing") return Response.json({ error: "not_found" }, { status: 404 });
    if (saved.kind === "conflict") return Response.json({ error: "version_conflict" }, { status: 409 });
    return Response.json({ versionNumber: saved.versionNumber });
  } catch { return Response.json({ error: "profile_save_failed" }, { status: 503 }); }
}
