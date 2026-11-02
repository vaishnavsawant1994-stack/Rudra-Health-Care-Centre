import { z } from "zod";
import { decryptOperationalData, encryptOperationalData, operationalContext } from "@/server/operational-crypto";

export const publicContentSlugs = ["home", "about", "home-collection", "faq", "corporate", "doctors", "partners", "centres", "service-areas", "tests", "packages", "booking", "contact"] as const;
export type PublicContentSlug = (typeof publicContentSlugs)[number];
const contentSection = z.object({ heading: z.string().trim().min(1).max(120), body: z.string().trim().min(1).max(1600) }).strict();
export const publicContentSchema = z.object({
  title: z.string().trim().min(2).max(120),
  summary: z.string().trim().min(1).max(300),
  // Optional so already-encrypted content envelopes remain readable.
  seoTitle: z.string().trim().max(120).optional(),
  seoDescription: z.string().trim().max(300).optional(),
  sections: z.array(contentSection).min(1).max(12),
}).strict();
export type PublicContent = z.infer<typeof publicContentSchema>;
const siteContext = { centreId: "00000000-0000-0000-0000-000000000000" };

export function parsePublicContentSlug(value: string): PublicContentSlug | null {
  return (publicContentSlugs as readonly string[]).includes(value) ? value as PublicContentSlug : null;
}
export function sealWebsiteContent(organizationId: string, pageId: string, value: PublicContent) {
  return encryptOperationalData(value, operationalContext({ organizationId, ...siteContext, recordId: pageId }, "website-content-page"));
}
export function openWebsiteContent(organizationId: string, pageId: string, envelope: string) {
  return publicContentSchema.parse(decryptOperationalData<unknown>(envelope, operationalContext({ organizationId, ...siteContext, recordId: pageId }, "website-content-page")));
}
export function sealWebsiteContentEvent(organizationId: string, eventId: string, value: Record<string, unknown>) {
  return encryptOperationalData(value, operationalContext({ organizationId, ...siteContext, recordId: eventId }, "website-content-event"));
}
export function openWebsiteContentEvent(organizationId: string, eventId: string, envelope: string) {
  const value = decryptOperationalData<unknown>(envelope, operationalContext({ organizationId, ...siteContext, recordId: eventId }, "website-content-event"));
  return z.object({ slug: z.string().min(1).max(48), version: z.number().int().positive(), publishedVersion: z.number().int().positive().nullable().optional(), action: z.string().min(1).max(32), reason: z.string().max(500).optional() }).strict().parse(value);
}
