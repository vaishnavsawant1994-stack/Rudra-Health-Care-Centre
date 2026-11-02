import { z } from "zod";
import type { PermissionGrant } from "./permissions";
import { patientCreateSchema } from "./patient-policy";

export const leadStatuses = ["NEW", "CONTACTED", "QUALIFIED", "FOLLOW_UP", "CONVERTED", "LOST", "DUPLICATE", "DO_NOT_CONTACT"] as const;
export const leadSources = ["MANUAL", "WEBSITE", "WALK_IN", "PHONE", "REFERRAL", "PARTNER", "CORPORATE", "WHATSAPP", "CAMPAIGN"] as const;
export const leadContactStates = ["PENDING", "AUTHORIZED", "WITHDRAWN", "DO_NOT_CONTACT"] as const;
export const leadMarketingStates = ["NOT_REQUESTED", "GRANTED", "WITHDRAWN"] as const;

const emailField = z.union([z.email().max(254), z.literal("")]).transform((value) => value || null).optional();
const phoneField = z.string().trim().min(7).max(32).regex(/^\+?[0-9 ()-]+$/).refine((value) => value.replace(/\D/g, "").length >= 7 && value.replace(/\D/g, "").length <= 15).transform((value) => value.replace(/[ ()-]/g, "")).nullable().optional();

export const leadCreateSchema = z.object({
  centreId: z.uuid(), firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100), phone: phoneField, email: emailField,
  enquiryCategory: z.enum(["TEST", "PACKAGE", "HOME_COLLECTION", "GENERAL", "OTHER"]), interestedService: z.string().trim().max(160).nullable().optional(),
  homeCollectionInterest: z.boolean().default(false), source: z.enum(leadSources), sourceRelationshipId: z.uuid().nullable().optional(), sourceDoctorId: z.uuid().nullable().optional(), marketingCampaignId: z.uuid().nullable().optional(), campaign: z.string().trim().max(120).nullable().optional(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).default("NORMAL"), assignedStaffId: z.uuid().optional(), preferredChannel: z.enum(["PHONE", "EMAIL", "WHATSAPP", "NONE"]).default("PHONE"),
}).refine((value) => Boolean(value.phone || value.email), { message: "A phone number or email is required." })
  .refine((value) => !value.sourceRelationshipId || value.source === "CORPORATE" || value.source === "PARTNER", { message: "Select a corporate or partner source when linking a relationship." })
  .refine((value) => !value.sourceDoctorId || value.source === "REFERRAL", { message: "Select Referral as the source when linking a doctor." })
  .refine((value) => !value.sourceDoctorId || !value.sourceRelationshipId, { message: "A lead can have only one attributed source relationship." });

export const leadUpdateSchema = z.object({
  firstName: z.string().trim().min(1).max(100).optional(), lastName: z.string().trim().min(1).max(100).optional(), phone: phoneField, email: emailField,
  enquiryCategory: z.enum(["TEST", "PACKAGE", "HOME_COLLECTION", "GENERAL", "OTHER"]).optional(), interestedService: z.string().trim().max(160).nullable().optional(),
  homeCollectionInterest: z.boolean().optional(), source: z.enum(leadSources).optional(), campaign: z.string().trim().max(120).nullable().optional(),
  status: z.enum(leadStatuses).optional(), statusReason: z.string().trim().min(3).max(240).optional(), priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]).optional(), assignedStaffId: z.uuid().optional(),
  preferredChannel: z.enum(["PHONE", "EMAIL", "WHATSAPP", "NONE"]).optional(), contactPermission: z.enum(leadContactStates).optional(), contactEvidenceReference: z.string().trim().min(3).max(200).optional(),
  marketingConsent: z.enum(leadMarketingStates).optional(), marketingEvidenceReference: z.string().trim().min(3).max(200).optional(), lostReason: z.string().trim().min(3).max(240).optional(), duplicateOfLeadId: z.uuid().optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), "Provide a lead change.")
  .refine((value) => value.status === undefined || Boolean(value.statusReason), "Record an operational reason for each status change.")
  .refine((value) => value.statusReason === undefined || value.status !== undefined, "A status reason must accompany a status change.")
  .refine((value) => value.contactPermission === undefined || Boolean(value.contactEvidenceReference), "Evidence is required to change contact authorization.")
  .refine((value) => value.marketingConsent === undefined || Boolean(value.marketingEvidenceReference), "Evidence is required to change marketing consent.")
  .refine((value) => value.status !== "LOST" || Boolean(value.lostReason), "A reason is required when closing a lead as lost.")
  .refine((value) => value.status !== "DO_NOT_CONTACT" || Boolean(value.lostReason), "A reason is required when setting do-not-contact.")
  .refine((value) => value.status !== "DUPLICATE" || Boolean(value.duplicateOfLeadId), "Choose the matching lead when marking a duplicate.");

export const leadActivitySchema = z.discriminatedUnion("activityType", [
  z.object({ activityType: z.literal("NOTE"), body: z.string().trim().min(1).max(1000) }),
  z.object({ activityType: z.literal("CONTACT_ATTEMPT"), body: z.string().trim().min(1).max(500), outcome: z.enum(["CONTACTED", "NO_ANSWER", "CALLBACK_REQUESTED", "NOT_INTERESTED", "OTHER"]) }),
]);

export const leadFollowupCreateSchema = z.object({
  dueAt: z.iso.datetime({ offset: true }), assignedStaffId: z.uuid().optional(), taskType: z.enum(["ADMINISTRATIVE", "CONTACT"]).default("ADMINISTRATIVE"), note: z.string().trim().max(500).nullable().optional(),
});
export const leadFollowupUpdateSchema = z.object({
  dueAt: z.iso.datetime({ offset: true }).optional(), assignedStaffId: z.uuid().optional(), status: z.enum(["COMPLETED", "UNSUCCESSFUL", "CANCELLED"]).optional(),
  outcome: z.enum(["CONTACTED", "NO_ANSWER", "CALLBACK_REQUESTED", "NOT_INTERESTED", "OTHER"]).optional(), outcomeNote: z.string().trim().max(500).nullable().optional(),
}).refine((value) => Object.values(value).some((item) => item !== undefined), "Provide a follow-up change.")
  .refine((value) => !["COMPLETED", "UNSUCCESSFUL"].includes(value.status ?? "") || Boolean(value.outcome), "Select an outcome when completing a follow-up.");

export const leadConversionSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("NEW"), patient: patientCreateSchema }),
  z.object({ mode: z.literal("EXISTING"), patientId: z.uuid(), identityEvidenceReference: z.string().trim().min(3).max(200) }),
]);

const transitions: Record<(typeof leadStatuses)[number], readonly (typeof leadStatuses)[number][]> = {
  NEW: ["CONTACTED", "QUALIFIED", "FOLLOW_UP", "LOST", "DUPLICATE", "DO_NOT_CONTACT"],
  CONTACTED: ["QUALIFIED", "FOLLOW_UP", "LOST", "DUPLICATE", "DO_NOT_CONTACT"],
  QUALIFIED: ["FOLLOW_UP", "CONVERTED", "LOST", "DUPLICATE", "DO_NOT_CONTACT"],
  FOLLOW_UP: ["CONTACTED", "QUALIFIED", "CONVERTED", "LOST", "DUPLICATE", "DO_NOT_CONTACT"],
  CONVERTED: [], LOST: ["NEW"], DUPLICATE: ["NEW"], DO_NOT_CONTACT: ["NEW"],
};

export function canTransitionLead(input: { from: (typeof leadStatuses)[number]; to: (typeof leadStatuses)[number]; canReopen: boolean; contactPermission: (typeof leadContactStates)[number]; hasContactEvidence: boolean }) {
  if (input.from === input.to) return true;
  if (!transitions[input.from].includes(input.to)) return false;
  if (["LOST", "DUPLICATE", "DO_NOT_CONTACT"].includes(input.from) && input.to === "NEW") {
    if (!input.canReopen) return false;
    if (input.from === "DO_NOT_CONTACT" && (input.contactPermission !== "AUTHORIZED" || !input.hasContactEvidence)) return false;
  }
  return true;
}

export function hasLeadCentrePermission(grants: PermissionGrant[], permission: string, centreId: string) {
  return grants.some((grant) => grant.key === permission && (grant.centreId === null || grant.centreId === centreId));
}

export function visibleLeadCentres(grants: PermissionGrant[], permission: string): string[] | null {
  const scopes = grants.filter((grant) => grant.key === permission).map((grant) => grant.centreId);
  return scopes.includes(null) ? null : scopes.filter((scope): scope is string => scope !== null);
}

export function leadContactAllowed(input: { status: string; contactPermission: string }) {
  return input.status !== "DO_NOT_CONTACT" && input.contactPermission === "AUTHORIZED";
}

export function communicationDraftDenial(input: { status: string; contactPermission: string; preferredChannel: string; marketingConsent: string; purpose: "OPERATIONAL" | "MARKETING"; channel: string }) {
  if (!leadContactAllowed(input)) return "contact_permission_required";
  if (!(["NEW", "CONTACTED", "QUALIFIED", "FOLLOW_UP"] as string[]).includes(input.status)) return "lead_not_contactable";
  if (input.preferredChannel !== input.channel || input.channel === "NONE") return "preferred_channel_mismatch";
  if (input.purpose === "MARKETING" && input.marketingConsent !== "GRANTED") return "marketing_consent_required";
  return null;
}
