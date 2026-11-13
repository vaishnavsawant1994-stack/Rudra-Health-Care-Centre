import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { fingerprintOperationalRequest, operationalContext, verifyOperationalRequestFingerprint, type OperationalCryptoContext } from "@/server/operational-crypto";

const phone = z.string().trim().min(7).max(32).regex(/^[+0-9 ()-]+$/).optional().or(z.literal(""));
const email = z.string().trim().email().max(254).optional().or(z.literal(""));
const campaignLabel = z.string().regex(/^[a-z0-9._-]{1,24}$/);

export const publicEnquiryCreateSchema = z.object({
  centreId: z.uuid(), firstName: z.string().trim().min(1).max(100), lastName: z.string().trim().min(1).max(100),
  organizationName: z.string().trim().max(160).optional().or(z.literal("")),
  phone, email, category: z.enum(["TEST", "PACKAGE", "HOME_COLLECTION", "GENERAL", "OTHER", "SUPPORT"]),
  requestTopic: z.enum(["GENERAL", "CORPORATE", "DOCTOR", "PARTNER"]).default("GENERAL"),
  requestKind: z.enum(["INQUIRY", "BOOKING_REQUEST"]).default("INQUIRY"),
  requestedService: z.string().trim().max(160).optional().or(z.literal("")),
  requestedCatalogueItemId: z.uuid().optional(),
  requestedCatalogueVersion: z.number().int().positive().optional(),
  requestedCatalogueItems: z.array(z.object({ id: z.uuid(), version: z.number().int().positive() })).min(1).max(20).optional(),
  requestedHomeCharge: z.enum(["0", "75", "99", "150"]).optional(),
  campaignAttribution: z.object({ source: campaignLabel.optional(), medium: campaignLabel.optional(), campaign: campaignLabel.optional() }).optional(),
  preferredDate: z.iso.date().optional().or(z.literal("")), preferredTimeWindow: z.string().trim().max(120).optional().or(z.literal("")),
  visitType: z.enum(["CENTRE", "HOME_COLLECTION"]).optional(),
  addressLine1: z.string().trim().max(160).optional().or(z.literal("")), addressLine2: z.string().trim().max(160).optional().or(z.literal("")),
  city: z.string().trim().max(100).optional().or(z.literal("")), state: z.string().trim().max(100).optional().or(z.literal("")), postalCode: z.string().trim().max(16).optional().or(z.literal("")),
  message: z.string().trim().min(5).max(1200), responsePermission: z.boolean(), website: z.string().max(200).optional(),
}).refine((value) => Boolean(value.phone || value.email), { message: "A phone number or email is required." })
  .refine((value) => Boolean(value.requestedCatalogueItemId) === Boolean(value.requestedCatalogueVersion), { message: "A selected catalogue item and version must be supplied together." })
  .refine((value) => !(value.requestedCatalogueItems && value.requestedCatalogueItemId), { message: "Use either the current multi-item field or the legacy single-item fields." })
  .refine((value) => !value.requestedCatalogueItems || new Set(value.requestedCatalogueItems.map((item) => item.id)).size === value.requestedCatalogueItems.length, { message: "A catalogue item cannot be selected more than once." })
  .refine((value) => value.requestKind !== "BOOKING_REQUEST" || Boolean(value.preferredDate), { message: "A preferred date is required for a booking request." })
  .refine((value) => value.visitType !== "HOME_COLLECTION" || Boolean(value.addressLine1 && value.city && value.state && value.postalCode), { message: "A complete address is required for home collection." })
  .refine((value) => value.visitType === "HOME_COLLECTION" || !value.requestedHomeCharge, { message: "A home collection fee can only be requested for home collection." });

export const publicEnquiryReviewSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("CONVERT_TO_LEAD"), expectedVersion: z.number().int().positive(), assignedStaffId: z.uuid() }),
  z.object({ action: z.literal("CONVERT_TO_RELATIONSHIP"), expectedVersion: z.number().int().positive() }),
  z.object({ action: z.literal("DISMISS"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240) }),
]);

export type PublicEnquiryPayload = {
  firstName: string; lastName: string; organizationName?: string | null; phone: string | null; email: string | null; category: string; requestTopic: "GENERAL" | "CORPORATE" | "DOCTOR" | "PARTNER"; message: string;
  requestKind: "INQUIRY" | "BOOKING_REQUEST"; requestedService: string | null; requestedCatalogueItemId?: string | null; requestedCatalogueVersion?: number | null; preferredDate: string | null; preferredTimeWindow: string | null;
  requestedCatalogueItems?: Array<{ id: string; version: number; serviceType: "TEST" | "PACKAGE"; serviceCode: string; displayName: string; priceAmount: string; currency: string }> | null;
  requestedHomeChargeChoice?: "0" | "75" | "99" | "150" | null; requestedHomeChargeRupees?: number | null;
  visitType: "CENTRE" | "HOME_COLLECTION" | null; collectionAddress: { line1: string; line2?: string; city: string; state: string; postalCode: string } | null;
  responsePermission: boolean; responsePermissionTextVersion: "PUBLIC_ENQUIRY_RESPONSE_V1"; submittedAt: string; reviewReason?: string;
  campaignAttribution?: { source?: string; medium?: string; campaign?: string } | null;
};

/** Compact, explicitly untrusted UTM metadata for the encrypted CRM campaign field. */
export function formatPublicCampaignAttribution(value: PublicEnquiryPayload["campaignAttribution"]): string | null {
  if (!value) return null;
  const fields = [["utm_source", value.source], ["utm_medium", value.medium], ["utm_campaign", value.campaign]] as const;
  const formatted = fields.flatMap(([name, label]) => label ? [`${name}=${label}`] : []).join(";");
  return formatted && formatted.length <= 120 ? formatted : null;
}

export function publicEnquiryContext(input: { organizationId: string; centreId: string; id: string }) {
  return { organizationId: input.organizationId, centreId: input.centreId, recordId: input.id };
}

export function publicEnquiryRequestContext(input: { organizationId: string; centreId: string; idempotencyKey: string }): OperationalCryptoContext {
  return operationalContext({ organizationId: input.organizationId, centreId: input.centreId, recordId: input.idempotencyKey }, "public-enquiry-idempotency");
}

export function publicEnquiryFingerprint(value: unknown, context: OperationalCryptoContext) {
  return fingerprintOperationalRequest(value, context);
}

/** Exact compatibility for request fingerprints stored before the operational keyring was used. */
export function legacyPublicEnquiryFingerprint(value: unknown) {
  const encoded = process.env.RUDRA_BLIND_INDEX_KEY;
  if (!encoded || !/^[A-Za-z0-9+/]{43}=$/.test(encoded)) throw new Error("lead_blind_index_key_unavailable");
  const key = Buffer.from(encoded, "base64");
  if (key.length !== 32) throw new Error("lead_blind_index_key_invalid");
  return createHmac("sha256", key).update("rudra:public-enquiry-idempotency:v1:").update(JSON.stringify(value)).digest("hex");
}

export function verifyPublicEnquiryFingerprint(value: unknown, fingerprint: string, context: OperationalCryptoContext) {
  if (verifyOperationalRequestFingerprint(value, fingerprint, context)) return true;
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) return false;
  const expected = Buffer.from(fingerprint, "hex");
  const legacy = Buffer.from(legacyPublicEnquiryFingerprint(value), "hex");
  return timingSafeEqual(expected, legacy);
}
