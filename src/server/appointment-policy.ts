import { z } from "zod";
import type { PermissionGrant } from "./permissions";

export const appointmentStatuses = ["REQUESTED", "CONFIRMED", "ASSIGNED", "RESCHEDULED", "CANCELLED", "NO_SHOW"] as const;
export const appointmentVisitTypes = ["CENTRE", "HOME_COLLECTION"] as const;
export const appointmentServiceTypes = ["TEST", "PACKAGE", "OTHER"] as const;
export const homeChargeChoices = ["ZERO", "75", "99", "150", "CUSTOM", "WAIVED"] as const;

const localDateTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use local date and time.");
const addressSchema = z.object({
  line1: z.string().trim().min(3).max(160), line2: z.string().trim().max(160).optional(),
  city: z.string().trim().min(2).max(100), state: z.string().trim().min(2).max(100), postalCode: z.string().trim().min(4).max(16),
});

const homeCollectionSchema = z.object({
  address: addressSchema, preferredWindow: z.string().trim().min(3).max(120), instructions: z.string().trim().max(500).optional(),
  chargeChoice: z.enum(homeChargeChoices), customAmountRupees: z.number().int().min(1).max(100000).optional(), chargeReason: z.string().trim().min(3).max(240).optional(),
}).superRefine((value, ctx) => {
  if (value.chargeChoice === "CUSTOM" && (value.customAmountRupees === undefined || !value.chargeReason)) ctx.addIssue({ code: "custom", message: "A custom charge amount and reason are required." });
  if (value.chargeChoice === "WAIVED" && !value.chargeReason) ctx.addIssue({ code: "custom", message: "A reason is required to waive the home-collection charge." });
  if (value.chargeChoice !== "CUSTOM" && value.customAmountRupees !== undefined) ctx.addIssue({ code: "custom", message: "Custom amount is only used for a custom charge." });
});

const serviceSchema = z.object({ type: z.enum(appointmentServiceTypes), name: z.string().trim().min(2).max(160), reference: z.string().trim().max(100).optional() });

export const appointmentCreateSchema = z.object({
  centreId: z.uuid(), patientId: z.uuid(), leadId: z.uuid().optional(), source: z.enum(["STAFF", "CRM_LEAD", "PHONE", "WALK_IN", "WEBSITE_PENDING", "REFERRAL"]).default("STAFF"),
  visitType: z.enum(appointmentVisitTypes), scheduledLocal: localDateTime, durationMinutes: z.number().int().min(10).max(240).default(30),
  assignedStaffId: z.uuid().optional(), services: z.array(serviceSchema).min(1).max(10),
  homeCollection: homeCollectionSchema.optional(),
}).superRefine((value, ctx) => {
  if (value.visitType === "HOME_COLLECTION" && !value.homeCollection) ctx.addIssue({ code: "custom", path: ["homeCollection"], message: "Home-collection details are required." });
  if (value.visitType === "CENTRE" && value.homeCollection) ctx.addIssue({ code: "custom", path: ["homeCollection"], message: "Centre visits cannot contain home-collection charges or addresses." });
});

export const appointmentUpdateSchema = z.object({
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
  status: z.enum(appointmentStatuses).optional(), reason: z.string().trim().min(3).max(240).optional(), scheduledLocal: localDateTime.optional(),
  durationMinutes: z.number().int().min(10).max(240).optional(), assignedStaffId: z.uuid().nullable().optional(),
  collectionInstructions: z.string().trim().max(500).nullable().optional(), homeCollectionWindow: z.string().trim().min(3).max(120).optional(),
  communicationPermission: z.enum(["AUTHORIZED", "WITHDRAWN"]).optional(), communicationEvidenceReference: z.string().trim().min(3).max(200).optional(),
}).refine((value) => Object.entries(value).some(([key, item]) => key !== "expectedUpdatedAt" && item !== undefined), "Provide an appointment change.")
  .refine((value) => value.status === undefined || Boolean(value.reason), "A reason is required for appointment status changes.")
  .refine((value) => value.scheduledLocal === undefined || Boolean(value.reason), "A reason is required to reschedule.")
  .refine((value) => value.assignedStaffId === undefined || Boolean(value.reason), "A reason is required to change staff assignment.")
  .refine((value) => value.communicationPermission === undefined || Boolean(value.communicationEvidenceReference), "Evidence is required to change communication permission.");

const appointmentTransitions: Record<(typeof appointmentStatuses)[number], readonly (typeof appointmentStatuses)[number][]> = {
  REQUESTED: ["CONFIRMED", "ASSIGNED", "RESCHEDULED", "CANCELLED"],
  CONFIRMED: ["ASSIGNED", "RESCHEDULED", "CANCELLED", "NO_SHOW"],
  ASSIGNED: ["CONFIRMED", "RESCHEDULED", "CANCELLED", "NO_SHOW"],
  RESCHEDULED: ["CONFIRMED", "ASSIGNED", "RESCHEDULED", "CANCELLED"],
  CANCELLED: [], NO_SHOW: ["RESCHEDULED", "CANCELLED"],
};

export function canTransitionAppointment(from: (typeof appointmentStatuses)[number], to: (typeof appointmentStatuses)[number]) {
  return from === to || appointmentTransitions[from].includes(to);
}

export function appointmentPermission(grants: PermissionGrant[], permission: string, centreId: string) {
  return grants.some((grant) => grant.key === permission && (grant.centreId === null || grant.centreId === centreId));
}

export function visibleAppointmentCentres(grants: PermissionGrant[], permission: string) {
  const scopes = grants.filter((grant) => grant.key === permission).map((grant) => grant.centreId);
  return scopes.includes(null) ? null : scopes.filter((id): id is string => id !== null);
}

export function localDateTimeToUtc(local: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  const target = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  if (new Date(target).toISOString().slice(0, 16) !== local) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    let guess = target;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
      const renderedAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
      const delta = target - renderedAsUtc;
      if (delta === 0) return new Date(guess);
      guess += delta;
    }
  } catch { return null; }
  return null;
}

export function homeCharge(choice: (typeof homeChargeChoices)[number], customAmount?: number) {
  if (choice === "ZERO" || choice === "WAIVED") return 0;
  if (choice === "CUSTOM") return customAmount ?? null;
  return Number(choice);
}
