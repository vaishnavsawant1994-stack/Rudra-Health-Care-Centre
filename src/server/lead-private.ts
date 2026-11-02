import { randomUUID } from "node:crypto";
import { leadActivities, leadPrivateData } from "@/db/schema";
import { getDb } from "@/db/client";
import { blindIndexLeadContact, encryptLeadPrivateData, encryptLeadValue, type LeadCryptoContext, type LeadPrivateData } from "@/server/lead-crypto";

type LeadTransaction = Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];

export async function saveLeadPrivateData(tx: LeadTransaction, context: LeadCryptoContext, data: LeadPrivateData) {
  const phone = data.phone?.trim() || null;
  const email = data.email?.trim().toLowerCase() || null;
  const normalized = { ...data, phone, email };
  const payloadCiphertext = encryptLeadPrivateData(normalized, context);
  await tx.insert(leadPrivateData).values({ leadId: context.recordId, organizationId: context.organizationId, centreId: context.centreId,
    payloadCiphertext,
    phoneBlindIndex: phone ? blindIndexLeadContact("phone", phone) : null,
    emailBlindIndex: email ? blindIndexLeadContact("email", email) : null,
  }).onConflictDoUpdate({ target: leadPrivateData.leadId, set: { payloadCiphertext, phoneBlindIndex: phone ? blindIndexLeadContact("phone", phone) : null, emailBlindIndex: email ? blindIndexLeadContact("email", email) : null, updatedAt: new Date() } });
}

export async function addLeadActivity(tx: LeadTransaction, input: { organizationId: string; centreId: string; leadId: string; actorStaffId: string; activityType: string; body?: string | null; metadata?: Record<string, unknown> }) {
  const id = randomUUID();
  await tx.insert(leadActivities).values({ id, organizationId: input.organizationId, centreId: input.centreId, leadId: input.leadId, actorStaffId: input.actorStaffId,
    activityType: input.activityType, privatePayloadCiphertext: encryptLeadValue("activity", { body: input.body ?? null, metadata: input.metadata ?? {} }, { organizationId: input.organizationId, centreId: input.centreId, recordId: id }) });
  return id;
}
