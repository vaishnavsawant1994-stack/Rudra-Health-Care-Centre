import { randomUUID } from "node:crypto";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { getDb } from "@/db/client";
import { patientContactSecrets, patients } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { patientCreateSchema } from "@/server/patient-policy";
import { searchAuthorizedPatients } from "@/server/patient-search";
import { blindIndexPatientContact, encryptPatientContacts, encryptPatientIdentity } from "@/server/patient-contact-crypto";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const requestedCentre = url.searchParams.get("centreId");
  if (requestedCentre && !z.uuid().safeParse(requestedCentre).success) return Response.json({ error: "invalid_centre" }, { status: 400 });
  if (url.searchParams.has("q")) return Response.json({ error: "search_requires_post" }, { status: 400 });
  const access = await getApiAccess("patients.read", requestedCentre ?? undefined);
  if (access.response) return access.response;
  return searchAuthorizedPatients(access.staff, "", requestedCentre);
}

export async function POST(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const parsed = patientCreateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input", fields: parsed.error.issues.map((issue) => issue.path.join(".")) }, { status: 400 });
  const access = await getApiAccess("patients.create", parsed.data.centreId);
  if (access.response) return access.response;
  const db = getDb();
  const patientId = randomUUID();
  const patientNumber = `RHC-${new Date().getFullYear()}-${patientId.slice(0, 8).toUpperCase()}`;
  const { centreId, ...data } = parsed.data;
  const email = data.email?.toLowerCase() || null;
  const phoneIndex=blindIndexPatientContact("phone",data.phone);const emailIndex=email?blindIndexPatientContact("email",email):null;
  try {
    const created = await db.transaction(async (tx) => {
      const [duplicate] = await tx.select({ id: patientContactSecrets.patientId }).from(patientContactSecrets).where(and(eq(patientContactSecrets.organizationId, access.staff.organizationId),eq(patientContactSecrets.centreId,centreId),or(eq(patientContactSecrets.phoneBlindIndex,phoneIndex),emailIndex?eq(patientContactSecrets.emailBlindIndex,emailIndex):undefined))).limit(1);
      if (duplicate) throw new Error("duplicate_review_required");
      const [patient] = await tx.insert(patients).values({
        id: patientId,
        organizationId: access.staff.organizationId,
        centreId,
        patientNumber,
        consentStatus: data.consentStatus,
        consentMethod: data.consentMethod ?? null,
        consentRecordedAt: data.consentStatus === "NOT_RECORDED" ? null : new Date(),
        createdByStaffId: access.staff.staffUserId,
      }).returning({ id: patients.id, patientNumber: patients.patientNumber, centreId: patients.centreId });
      const context={organizationId:access.staff.organizationId,centreId,patientId};
      await tx.insert(patientContactSecrets).values({patientId,organizationId:access.staff.organizationId,centreId,...encryptPatientContacts({phone:data.phone,email,profile:{preferredName:data.preferredName??null,dateOfBirth:data.dateOfBirth,sexAtRegistration:data.sexAtRegistration??null,address:data.address??null}},context),...encryptPatientIdentity({firstName:data.firstName,lastName:data.lastName},context)});
      await appendAuditEvent(tx, { organizationId: access.staff.organizationId, centreId, actorStaffId: access.staff.staffUserId, action: "patient.registered", entityType: "patient", entityId: patientId, details: { consentStatus: data.consentStatus } });
      return patient;
    });
    return Response.json({ patient: { ...created, firstName: data.firstName, lastName: data.lastName } }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message === "duplicate_review_required") return Response.json({ error: "possible_duplicate_review_required" }, { status: 409 });
    return Response.json({ error: "patient_registration_unavailable" }, { status: 409 });
  }
}
