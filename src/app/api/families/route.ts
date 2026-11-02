import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { getDb } from "@/db/client";
import { families } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { familyCreateSchema } from "@/server/family-policy";
import { searchAuthorizedFamilies } from "@/server/family-search";
import { blindIndexFamilyName, encryptFamilyValue } from "@/server/family-crypto";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const centreId = url.searchParams.get("centreId");
  if (url.searchParams.has("q")) return Response.json({ error: "search_requires_post" }, { status: 400 });
  if (centreId && !z.uuid().safeParse(centreId).success) return Response.json({ error: "invalid_centre" }, { status: 400 });
  const access = await getApiAccess("families.read", centreId ?? undefined);
  if (access.response) return access.response;
  const patientAccess = await getApiAccess("patients.read", centreId ?? undefined);
  if (patientAccess.response) return patientAccess.response;
  return searchAuthorizedFamilies(access.staff, "", centreId);
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const parsed = familyCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const access = await getApiAccess("families.create", parsed.data.centreId);
  if (access.response) return access.response;
  const familyId = randomUUID();
  const familyNumber = `RHC-F-${new Date().getFullYear()}-${familyId.slice(0, 8).toUpperCase()}`;
  try {
    const family = await getDb().transaction(async (tx) => {
      const context = { organizationId: access.staff.organizationId, centreId: parsed.data.centreId, recordId: familyId };
      await tx.insert(families).values({ id: familyId, organizationId: access.staff.organizationId, centreId: parsed.data.centreId, familyNumber, displayNameCiphertext: encryptFamilyValue("display-name", parsed.data.displayName, context), displayNameBlindIndex: blindIndexFamilyName(parsed.data.displayName), createdByStaffId: access.staff.staffUserId });
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId: parsed.data.centreId, actorStaffId: access.staff.staffUserId, action: "family.created", entityType: "family", entityId: familyId, details: { status: "created" } });
      return { id: familyId, familyNumber, displayName: parsed.data.displayName, centreId: parsed.data.centreId };
    });
    return Response.json({ family }, { status: 201 });
  } catch {
    return Response.json({ error: "family_creation_unavailable" }, { status: 409 });
  }
}
