import { z } from "zod";
import type { PermissionGrant } from "./permissions";

const patientAddressSchema = z.object({
  line1: z.string().trim().max(160).optional(),
  line2: z.string().trim().max(160).optional(),
  city: z.string().trim().max(100).optional(),
  state: z.string().trim().max(100).optional(),
  postalCode: z.string().trim().max(16).optional(),
}).nullable().optional();

const patientFields = {
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  preferredName: z.string().trim().max(100).nullable().optional(),
  dateOfBirth: z.iso.date().refine((date) => date <= new Date().toISOString().slice(0, 10), "Date of birth cannot be in the future."),
  sexAtRegistration: z.enum(["FEMALE", "MALE", "INTERSEX", "UNSPECIFIED"]).nullable().optional(),
  phone: z.string().trim().min(7).max(32).regex(/^\+?[0-9 ()-]+$/).refine((value) => {
    const digits = value.replace(/\D/g, "").length;
    return digits >= 7 && digits <= 15;
  }, "Phone must contain between 7 and 15 digits.").transform((value) => value.replace(/[ ()-]/g, "")),
  email: z.union([z.email().max(254), z.literal("")]).nullable().optional(),
  address: patientAddressSchema,
  consentStatus: z.enum(["NOT_RECORDED", "GRANTED", "DECLINED", "WITHDRAWN"]).default("NOT_RECORDED"),
  consentMethod: z.preprocess((value) => value === "" ? null : value, z.enum(["IN_PERSON", "PHONE", "ONLINE", "WRITTEN"]).nullable().optional()),
};

function consentPairIsValid(status: string | undefined, method: string | null | undefined) {
  if (status === "NOT_RECORDED") return method == null;
  return Boolean(status && method);
}

export const patientCreateSchema = z.object({ ...patientFields, centreId: z.uuid() })
  .refine((data) => consentPairIsValid(data.consentStatus, data.consentMethod), "Choose a consent method only when consent is recorded.");

export const patientUpdateSchema = z.object({
  firstName: patientFields.firstName.optional(),
  lastName: patientFields.lastName.optional(),
  preferredName: patientFields.preferredName,
  dateOfBirth: patientFields.dateOfBirth.optional(),
  sexAtRegistration: patientFields.sexAtRegistration,
  phone: patientFields.phone.optional(),
  email: patientFields.email,
  address: patientFields.address,
  consentStatus: z.enum(["NOT_RECORDED", "GRANTED", "DECLINED", "WITHDRAWN"]).optional(),
  consentMethod: patientFields.consentMethod.optional(),
}).refine((data) => Object.values(data).some((value) => value !== undefined), "At least one field is required.")
  .refine((data) => data.consentMethod === undefined || data.consentStatus !== undefined, "Consent status is required when changing the consent method.")
  .refine((data) => data.consentStatus === undefined || consentPairIsValid(data.consentStatus, data.consentMethod), "A consent method is required for recorded consent; it must be empty when not recorded.");

export function canAccessPatientCentre(grants: PermissionGrant[], permission: string, centreId: string) {
  return grants.some((grant) => grant.key === permission && (grant.centreId === null || grant.centreId === centreId));
}

export function visiblePatientCentres(grants: PermissionGrant[], permission: string) {
  const scoped = grants.filter((grant) => grant.key === permission).map((grant) => grant.centreId);
  return scoped.includes(null) ? null : scoped.filter((centreId): centreId is string => centreId !== null);
}

export function normalizePatientSearch(value: string) {
  return value.trim().replace(/[\\%_]/g, "\\$&");
}
