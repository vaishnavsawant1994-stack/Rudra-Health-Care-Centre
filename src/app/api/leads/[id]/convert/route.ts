import { createHash, randomUUID } from "node:crypto";
import { and, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getApiAccess } from "@/server/access";
import { appendAuditEvent } from "@/server/audit";
import { getDb } from "@/db/client";
import { leadConversions, leadPrivateData, leads, patientContactSecrets, patients } from "@/db/schema";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { hasLeadCentrePermission } from "@/server/lead-policy";
import { leadConversionSchema } from "@/server/lead-policy";
import { blindIndexPatientContact, decryptPatientContacts, encryptPatientContacts, encryptPatientIdentity } from "@/server/patient-contact-crypto";
import { decryptLeadPrivateData, encryptLeadValue } from "@/server/lead-crypto";
import { addLeadActivity } from "@/server/lead-private";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) return Response.json({ error: "not_found" }, { status: 404 });
  const parsed = leadConversionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "invalid_input" }, { status: 400 });
  const access = await getApiAccess("leads.convert");
  if (access.response) return access.response;
  const db = getDb();
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, id), eq(leads.organizationId, access.staff.organizationId))).limit(1);
  if (!lead || !hasLeadCentrePermission(access.staff.grants, "leads.convert", lead.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const [privateRow] = await db.select({ payloadCiphertext: leadPrivateData.payloadCiphertext }).from(leadPrivateData).where(and(eq(leadPrivateData.leadId, id), eq(leadPrivateData.organizationId, lead.organizationId), eq(leadPrivateData.centreId, lead.centreId))).limit(1);
  if (!privateRow) return Response.json({ error: "not_found" }, { status: 404 });
  const leadPrivate = decryptLeadPrivateData(privateRow.payloadCiphertext, { organizationId: lead.organizationId, centreId: lead.centreId, recordId: lead.id });
  const patientPermission = await getApiAccess(parsed.data.mode === "NEW" ? "patients.create" : "patients.read", lead.centreId);
  if (patientPermission.response) return patientPermission.response;
  const patientRead = await getApiAccess("patients.read", lead.centreId);
  if (patientRead.response) return patientRead.response;
  if (parsed.data.mode === "NEW") {
    const newPatientEmail = parsed.data.patient.email?.toLowerCase() || null;
    const matchesLead = Boolean((leadPrivate.phone && leadPrivate.phone === parsed.data.patient.phone) || (leadPrivate.email && leadPrivate.email.toLowerCase() === newPatientEmail));
    if (parsed.data.patient.centreId !== lead.centreId || !matchesLead) return Response.json({ error: "conversion_identity_mismatch" }, { status: 409 });
  }
  try {
    const conversion = await db.transaction(async (tx) => {
      const [locked] = await tx.select().from(leads).where(and(eq(leads.id, id), eq(leads.organizationId, access.staff.organizationId))).for("update").limit(1);
      if (!locked) throw new Error("lead_missing");
      const [existingConversion] = await tx.select({ id: leadConversions.id, patientId: leadConversions.patientId, conversionMode: leadConversions.conversionMode, convertedAt: leadConversions.convertedAt }).from(leadConversions).where(and(eq(leadConversions.leadId, id), eq(leadConversions.organizationId, access.staff.organizationId))).limit(1);
      if (existingConversion) return existingConversion;
      if (!["QUALIFIED", "FOLLOW_UP"].includes(locked.status)) throw new Error("lead_not_qualified");

      let patientId: string;
      if (parsed.data.mode === "EXISTING") {
        const [existingPatient] = await tx.select({ id: patients.id }).from(patients).where(and(eq(patients.id, parsed.data.patientId), eq(patients.organizationId, locked.organizationId), eq(patients.centreId, locked.centreId))).limit(1);
        const [contactSecret]=existingPatient?await tx.select().from(patientContactSecrets).where(and(eq(patientContactSecrets.patientId,existingPatient.id),eq(patientContactSecrets.organizationId,locked.organizationId),eq(patientContactSecrets.centreId,locked.centreId))).limit(1):[];
        const existingContact=contactSecret&&existingPatient?decryptPatientContacts(contactSecret,{organizationId:locked.organizationId,centreId:locked.centreId,patientId:existingPatient.id}):null;
        if (!existingPatient || !existingContact || !((leadPrivate.phone && leadPrivate.phone === existingContact.phone) || (leadPrivate.email && leadPrivate.email.toLowerCase() === existingContact.email?.toLowerCase()))) throw new Error("identity_not_matched");
        patientId = existingPatient.id;
      } else {
        const email = parsed.data.patient.email?.toLowerCase() || null;
        const identityLocks = [parsed.data.patient.phone ? `phone:${parsed.data.patient.phone}` : null, email ? `email:${email}` : null].filter((value): value is string => value !== null).sort();
        for (const identity of identityLocks) {
          const lockKey = createHash("sha256").update(`${locked.organizationId}:${locked.centreId}:${identity}`).digest("hex");
          await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
        }
        const phoneIndex=blindIndexPatientContact("phone",parsed.data.patient.phone);const emailIndex=email?blindIndexPatientContact("email",email):null;
        const contactMatches = or(eq(patientContactSecrets.phoneBlindIndex,phoneIndex), emailIndex ? eq(patientContactSecrets.emailBlindIndex,emailIndex) : undefined);
        const [duplicate] = await tx.select({ id: patientContactSecrets.patientId }).from(patientContactSecrets).where(and(eq(patientContactSecrets.organizationId, locked.organizationId), eq(patientContactSecrets.centreId, locked.centreId), contactMatches!)).limit(1);
        if (duplicate) throw new Error("possible_patient_duplicate_review_required");
        patientId = randomUUID();
        const p = parsed.data.patient;
        await tx.insert(patients).values({ id: patientId, organizationId: locked.organizationId, centreId: locked.centreId, patientNumber: `RHC-${new Date().getFullYear()}-${patientId.slice(0, 8).toUpperCase()}`, consentStatus: p.consentStatus, consentMethod: p.consentMethod ?? null, consentRecordedAt: p.consentStatus === "NOT_RECORDED" ? null : new Date(), createdByStaffId: access.staff.staffUserId });
        const context={organizationId:locked.organizationId,centreId:locked.centreId,patientId};
        await tx.insert(patientContactSecrets).values({patientId,organizationId:locked.organizationId,centreId:locked.centreId,...encryptPatientContacts({phone:p.phone,email,profile:{preferredName:p.preferredName??null,dateOfBirth:p.dateOfBirth,sexAtRegistration:p.sexAtRegistration??null,address:p.address??null}},context),...encryptPatientIdentity({firstName:p.firstName,lastName:p.lastName},context)});
        await appendAuditEvent(tx, { organizationId: locked.organizationId, centreId: locked.centreId, actorStaffId: access.staff.staffUserId, action: "patient.registered", entityType: "patient", entityId: patientId, details: { source: "lead_conversion", leadId: id, consentStatus: p.consentStatus } });
      }
      const now = new Date();
      const conversionId = randomUUID();
      const identityEvidenceCiphertext = parsed.data.mode === "EXISTING" ? encryptLeadValue("conversion-evidence", parsed.data.identityEvidenceReference, { organizationId: locked.organizationId, centreId: locked.centreId, recordId: conversionId }) : null;
      const [created] = await tx.insert(leadConversions).values({ id: conversionId, organizationId: locked.organizationId, centreId: locked.centreId, leadId: id, patientId, conversionMode: parsed.data.mode, identityEvidenceCiphertext, convertedByStaffId: access.staff.staffUserId, convertedAt: now }).returning({ id: leadConversions.id, patientId: leadConversions.patientId, conversionMode: leadConversions.conversionMode, convertedAt: leadConversions.convertedAt });
      await tx.update(leads).set({ status: "CONVERTED", convertedAt: now, updatedAt: now }).where(and(eq(leads.id, id), eq(leads.status, locked.status)));
      await addLeadActivity(tx, { organizationId: locked.organizationId, centreId: locked.centreId, leadId: id, actorStaffId: access.staff.staffUserId, activityType: "CONVERTED", metadata: { conversionMode: parsed.data.mode, conversionId: created.id } });
      await appendAuditEvent(tx, { organizationId: locked.organizationId, centreId: locked.centreId, actorStaffId: access.staff.staffUserId, action: "lead.converted", entityType: "lead", entityId: id, details: { conversionId: created.id, conversionMode: parsed.data.mode, status: "CONVERTED" } });
      return created;
    });
    return Response.json({ conversion }, { status: 200 });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "lead_not_qualified") return Response.json({ error: "lead_must_be_qualified" }, { status: 409 });
    if (code === "identity_not_matched") return Response.json({ error: "identity_match_required" }, { status: 409 });
    if (code === "possible_patient_duplicate_review_required") return Response.json({ error: "possible_patient_duplicate_review_required" }, { status: 409 });
    return Response.json({ error: "lead_conversion_unavailable" }, { status: 409 });
  }
}
