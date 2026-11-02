import { z } from "zod";
import type { PermissionGrant } from "./permissions";
import { patientCreateSchema } from "./patient-policy";

export const familyRelationshipValues = ["SELF", "SPOUSE", "PARENT", "CHILD", "SIBLING", "GUARDIAN", "DEPENDENT", "OTHER"] as const;
export const familyDataValues = ["DEMOGRAPHICS", "PATIENT_CONTACT", "APPOINTMENTS", "ORDERS", "REPORTS", "BILLING"] as const;
export const familyAuthorizationBases = ["PATIENT_SELF", "LEGAL_GUARDIAN", "OTHER_AUTHORIZED"] as const;

export const familyCreateSchema = z.object({ centreId: z.uuid(), displayName: z.string().trim().min(2).max(140) });
export const familyUpdateSchema = z.object({
  displayName: z.string().trim().min(2).max(140).optional(),
  primaryContactPatientId: z.uuid().nullable().optional(),
}).refine((body) => body.displayName !== undefined || body.primaryContactPatientId !== undefined, "Provide a family change.");

export const familyMemberCreateSchema = z.object({
  patientId: z.uuid().optional(),
  newPatient: patientCreateSchema.optional(),
  relationship: z.enum(familyRelationshipValues),
}).refine((body) => Boolean(body.patientId) !== Boolean(body.newPatient), "Provide either an existing patient ID or new patient registration details.");

export const familyMemberUpdateSchema = z.object({
  relationship: z.enum(familyRelationshipValues).optional(),
  verify: z.literal(true).optional(),
  authorizationBasis: z.enum(familyAuthorizationBases).optional(),
  evidenceReference: z.string().trim().min(3).max(200).optional(),
}).refine((body) => body.relationship !== undefined || body.verify === true, "Provide a relationship change or verification.")
  .refine((body) => body.verify !== true || (body.authorizationBasis && body.evidenceReference), "Verification requires an authorization basis and reviewed evidence reference.");

export const familyGrantCreateSchema = z.object({
  patientId: z.uuid(),
  granteePatientId: z.uuid(),
  allowedData: z.array(z.enum(familyDataValues)).min(1).max(familyDataValues.length),
  purpose: z.string().trim().min(4).max(240),
  authorizationBasis: z.enum(familyAuthorizationBases),
  effectiveAt: z.iso.datetime({ offset: true }).optional(),
  expiresAt: z.iso.datetime({ offset: true }).nullable().optional(),
}).refine((body) => body.patientId !== body.granteePatientId, "A patient cannot grant themselves access through family sharing.")
  .refine((body) => !body.expiresAt || !body.effectiveAt || Date.parse(body.expiresAt) > Date.parse(body.effectiveAt), "Expiry must be later than the effective date.");

export const familyGrantVerifySchema = z.object({ verify: z.literal(true), evidenceReference: z.string().trim().min(3).max(200) });

export function canAccessFamilyCentre(grants: PermissionGrant[], permission: string, centreId: string) {
  return grants.some((grant) => grant.key === permission && (grant.centreId === null || grant.centreId === centreId));
}

export function visibleFamilyCentres(grants: PermissionGrant[], permission: string): string[] | null {
  const scope = grants.filter((grant) => grant.key === permission).map((grant) => grant.centreId);
  return scope.includes(null) ? null : scope.filter((centre): centre is string => centre !== null);
}

export type FamilyGrantForAccess = {
  patientId: string;
  granteePatientId: string;
  allowedData: string[];
  status: string;
  authorizationBasis: string;
  evidenceReference: string | null;
  verifiedAt: Date | null;
  effectiveAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

export function familyGrantAllows(grant: FamilyGrantForAccess | null | undefined, input: { patientId: string; granteePatientId: string; dataType: string; at?: Date }) {
  if (!grant) return false;
  const now = input.at ?? new Date();
  return grant.patientId === input.patientId
    && grant.granteePatientId === input.granteePatientId
    && grant.status === "ACTIVE"
    && grant.authorizationBasis.length > 0
    && Boolean(grant.evidenceReference)
    && grant.verifiedAt instanceof Date
    && grant.revokedAt === null
    && grant.effectiveAt <= now
    && (grant.expiresAt === null || grant.expiresAt > now)
    && grant.allowedData.includes(input.dataType);
}
