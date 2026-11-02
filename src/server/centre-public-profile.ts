import { z } from "zod";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";

export const centrePublicProfileSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  address: z.string().trim().max(500).nullable().default(null),
  phone: z.string().trim().max(40).nullable().default(null),
  email: z.string().trim().email().max(254).nullable().default(null),
  serviceArea: z.string().trim().max(300).nullable().default(null),
  openingHours: z.string().trim().max(500).nullable().default(null),
  published: z.boolean().default(false),
}).strict().superRefine((value, ctx) => {
  if (value.published && !value.address && !value.serviceArea) {
    ctx.addIssue({ code: "custom", path: ["address"], message: "A public address or service area is required before publishing." });
  }
});

export type CentrePublicProfile = z.infer<typeof centrePublicProfileSchema>;

export function centrePublicProfileContext(organizationId: string, centreId: string) {
  return operationalContext({ organizationId, centreId, recordId: centreId }, "centre-public-profile");
}

export function encryptCentrePublicProfile(profile: CentrePublicProfile, organizationId: string, centreId: string) {
  return encryptOperationalData(profile, centrePublicProfileContext(organizationId, centreId));
}

export function decryptCentrePublicProfile(ciphertext: string, organizationId: string, centreId: string) {
  return decryptOperationalData<CentrePublicProfile>(ciphertext, centrePublicProfileContext(organizationId, centreId));
}
