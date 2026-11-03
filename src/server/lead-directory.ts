import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import type { StaffContext } from "@/server/access";
import { getDb } from "@/db/client";
import { leadActivities, leadConversions, leadFollowups, leadPrivateData, leads, marketingCampaigns, patientContactSecrets, patients, staffUsers } from "@/db/schema";
import { hasLeadCentrePermission, visibleLeadCentres } from "@/server/lead-policy";
import { decryptPatientIdentity } from "@/server/patient-contact-crypto";
import { blindIndexLeadContact, decryptLeadPrivateData, decryptLeadValue } from "@/server/lead-crypto";

export type LeadFilters = { centreId?: string | null; status?: string | null; source?: string | null; assignedStaffId?: string | null; page?: number; pageSize?: number; q?: string };

export async function searchAuthorizedLeads(staff: StaffContext, filters: LeadFilters) {
  const scopedCentres = visibleLeadCentres(staff.grants, "leads.read");
  if (filters.centreId && !hasLeadCentrePermission(staff.grants, "leads.read", filters.centreId)) return Response.json({ error: "forbidden" }, { status: 403 });
  if (!filters.centreId && scopedCentres !== null && !scopedCentres.length) return Response.json({ leads: [], page: 1, pageSize: 25, total: 0 });
  const conditions = [eq(leads.organizationId, staff.organizationId)];
  if (filters.centreId) conditions.push(eq(leads.centreId, filters.centreId));
  else if (scopedCentres !== null) conditions.push(inArray(leads.centreId, scopedCentres));
  if (filters.source) conditions.push(eq(leads.source, filters.source));
  if (filters.assignedStaffId) conditions.push(eq(leads.assignedStaffId, filters.assignedStaffId));
  if (filters.q?.trim()) {
    const escaped = `%${filters.q.trim().replace(/[\\%_]/g, "\\$&")}%`;
    const query = filters.q.trim();
    conditions.push(or(sql`${leads.leadNumber} ILIKE ${escaped} ESCAPE '\\'`, eq(leadPrivateData.phoneBlindIndex, blindIndexLeadContact("phone", query)), eq(leadPrivateData.emailBlindIndex, blindIndexLeadContact("email", query)))!);
  }
  const countConditions = [...conditions];
  if (filters.status) conditions.push(eq(leads.status, filters.status));
  const page = Math.max(1, filters.page ?? 1);
  const pageSize = Math.min(50, Math.max(1, filters.pageSize ?? 25));
  const db = getDb();
  const [totalRows, rows, countRows] = await Promise.all([
    db.select({ total: sql<number>`count(*)::int` }).from(leads).innerJoin(leadPrivateData,and(eq(leadPrivateData.leadId,leads.id),eq(leadPrivateData.organizationId,leads.organizationId),eq(leadPrivateData.centreId,leads.centreId))).where(and(...conditions)),
    db.select({ id: leads.id, leadNumber: leads.leadNumber, privateCiphertext:leadPrivateData.payloadCiphertext, centreId: leads.centreId, enquiryCategory: leads.enquiryCategory, homeCollectionInterest:leads.homeCollectionInterest, source: leads.source, campaignCode: marketingCampaigns.campaignCode, status: leads.status, priority: leads.priority, contactPermission: leads.contactPermission, marketingConsent: leads.marketingConsent, assignedStaffId: leads.assignedStaffId, preferredChannel: leads.preferredChannel, createdAt: leads.createdAt, updatedAt: leads.updatedAt })
      .from(leads).innerJoin(leadPrivateData,and(eq(leadPrivateData.leadId,leads.id),eq(leadPrivateData.organizationId,leads.organizationId),eq(leadPrivateData.centreId,leads.centreId))).leftJoin(marketingCampaigns, and(eq(marketingCampaigns.id, leads.marketingCampaignId), eq(marketingCampaigns.organizationId, leads.organizationId), eq(marketingCampaigns.centreId, leads.centreId))).where(and(...conditions)).orderBy(desc(leads.updatedAt), desc(leads.createdAt)).limit(pageSize).offset((page - 1) * pageSize),
    db.select({ status: leads.status, count: sql<number>`count(*)::int` }).from(leads).where(and(...countConditions)).groupBy(leads.status),
  ]);
  return Response.json({ leads: rows.map(({privateCiphertext,...row}) => ({ ...row, ...decryptLeadPrivateData(privateCiphertext,{organizationId:staff.organizationId,centreId:row.centreId,recordId:row.id}), canUpdate: hasLeadCentrePermission(staff.grants, "leads.update", row.centreId) })), counts: Object.fromEntries(countRows.map((row) => [row.status, row.count])), page, pageSize, total: totalRows[0]?.total ?? 0 });
}

export async function getLeadDetail(staff: StaffContext, leadId: string) {
  const db = getDb();
  const [lead] = await db.select().from(leads).where(and(eq(leads.id, leadId), eq(leads.organizationId, staff.organizationId))).limit(1);
  if (!lead || !hasLeadCentrePermission(staff.grants, "leads.read", lead.centreId)) return Response.json({ error: "not_found" }, { status: 404 });
  const [privateRow]=await db.select({payloadCiphertext:leadPrivateData.payloadCiphertext}).from(leadPrivateData).where(and(eq(leadPrivateData.leadId,lead.id),eq(leadPrivateData.organizationId,staff.organizationId),eq(leadPrivateData.centreId,lead.centreId))).limit(1);
  if(!privateRow)return Response.json({error:"not_found"},{status:404});
  const [attributedCampaign] = lead.marketingCampaignId ? await db.select({ campaignCode: marketingCampaigns.campaignCode }).from(marketingCampaigns).where(and(eq(marketingCampaigns.id, lead.marketingCampaignId), eq(marketingCampaigns.organizationId, lead.organizationId), eq(marketingCampaigns.centreId, lead.centreId))).limit(1) : [];
  const leadView={...lead,campaignCode:attributedCampaign?.campaignCode ?? null,...decryptLeadPrivateData(privateRow.payloadCiphertext,{organizationId:staff.organizationId,centreId:lead.centreId,recordId:lead.id})};
  const [activity, followups, conversion] = await Promise.all([
    db.select({ id: leadActivities.id, activityType: leadActivities.activityType, privatePayloadCiphertext:leadActivities.privatePayloadCiphertext, actorStaffId: leadActivities.actorStaffId, actorName: staffUsers.displayName, recordedAt: leadActivities.recordedAt }).from(leadActivities).innerJoin(staffUsers, and(eq(staffUsers.id, leadActivities.actorStaffId), eq(staffUsers.organizationId, leadActivities.organizationId))).where(and(eq(leadActivities.organizationId, staff.organizationId), eq(leadActivities.leadId, leadId))).orderBy(desc(leadActivities.recordedAt)).limit(100),
    db.select({ id: leadFollowups.id, assignedStaffId: leadFollowups.assignedStaffId, dueAt: leadFollowups.dueAt, taskType: leadFollowups.taskType, status: leadFollowups.status, outcome: leadFollowups.outcome, outcomeNoteCiphertext: leadFollowups.outcomeNoteCiphertext, createdAt: leadFollowups.createdAt, completedAt: leadFollowups.completedAt, centreId:leadFollowups.centreId }).from(leadFollowups).where(and(eq(leadFollowups.organizationId, staff.organizationId), eq(leadFollowups.leadId, leadId))).orderBy(desc(leadFollowups.dueAt)).limit(50),
    db.select({ id: leadConversions.id, patientId: leadConversions.patientId, conversionMode: leadConversions.conversionMode, convertedAt: leadConversions.convertedAt }).from(leadConversions).where(and(eq(leadConversions.organizationId, staff.organizationId), eq(leadConversions.leadId, leadId))).limit(1),
  ]);
  let convertedPatient: { patientNumber: string; firstName: string; lastName: string } | null = null;
  const canReadPatient = hasLeadCentrePermission(staff.grants, "patients.read", lead.centreId);
  if (conversion[0] && canReadPatient) {
    const [patient] = await db.select({ patientId:patients.id,patientNumber: patients.patientNumber,centreId:patients.centreId,encryptionKeyId:patientContactSecrets.encryptionKeyId,nameCiphertext:patientContactSecrets.nameCiphertext }).from(patients).innerJoin(patientContactSecrets,and(eq(patientContactSecrets.patientId,patients.id),eq(patientContactSecrets.organizationId,patients.organizationId),eq(patientContactSecrets.centreId,patients.centreId))).where(and(eq(patients.id, conversion[0].patientId), eq(patients.organizationId, staff.organizationId), eq(patients.centreId, lead.centreId))).limit(1);
    if(patient){const identity=decryptPatientIdentity(patient,{organizationId:staff.organizationId,centreId:patient.centreId,patientId:patient.patientId});convertedPatient={patientNumber:patient.patientNumber,...identity};}
  }
  const canReadAppointmentDetails = hasLeadCentrePermission(staff.grants, "appointments.read", lead.centreId)
    || hasLeadCentrePermission(staff.grants, "collections.read", lead.centreId);
  const activityView=activity.map(({privatePayloadCiphertext,...event})=>{
    const decrypted = decryptLeadValue<{body:string|null;metadata:Record<string,unknown> }>("activity",privatePayloadCiphertext,{organizationId:staff.organizationId,centreId:lead.centreId,recordId:event.id});
    const metadata = { ...decrypted.metadata };
    // A CRM read grant alone does not disclose a home-collection address.
    if (!canReadAppointmentDetails && metadata.source === "PUBLIC_ENQUIRY" && metadata.requestKind === "BOOKING_REQUEST") delete metadata.collectionAddress;
    return { ...event, ...decrypted, metadata };
  });
  const followupView=followups.map(({outcomeNoteCiphertext,centreId,...item})=>({...item,outcomeNote:outcomeNoteCiphertext?decryptLeadValue<string>("followup-note",outcomeNoteCiphertext,{organizationId:staff.organizationId,centreId,recordId:item.id}):null}));
  return Response.json({ lead:leadView, activity:activityView, followups:followupView, conversion: conversion[0] ? { ...conversion[0], patientId: canReadPatient ? conversion[0].patientId : null, patient: convertedPatient } : null, capabilities: {
    update: hasLeadCentrePermission(staff.grants, "leads.update", lead.centreId),
    assign: hasLeadCentrePermission(staff.grants, "leads.assign", lead.centreId),
    reopen: hasLeadCentrePermission(staff.grants, "leads.reopen", lead.centreId),
    convert: hasLeadCentrePermission(staff.grants, "leads.convert", lead.centreId),
    activity: hasLeadCentrePermission(staff.grants, "leads.activities.write", lead.centreId),
    followups: hasLeadCentrePermission(staff.grants, "leads.followups.manage", lead.centreId),
    marketingConsent: hasLeadCentrePermission(staff.grants, "leads.marketing_consent", lead.centreId),
    patientRead: hasLeadCentrePermission(staff.grants, "patients.read", lead.centreId),
    patientCreate: hasLeadCentrePermission(staff.grants, "patients.create", lead.centreId),
    appointmentCreate: hasLeadCentrePermission(staff.grants, "appointments.create", lead.centreId),
  } });
}
