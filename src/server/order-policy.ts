import { z } from "zod";

export const orderCreateSchema = z.object({
  centreId: z.uuid(), patientId: z.uuid().optional(), appointmentId: z.uuid().optional(), catalogueVersionIds: z.array(z.uuid()).min(1).max(50),
}).refine((value) => Boolean(value.patientId || value.appointmentId), "Select a patient or an appointment.");

export const orderUpdateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("replace_items"), expectedVersion: z.number().int().positive(), catalogueVersionIds: z.array(z.uuid()).min(1).max(50), reason: z.string().trim().min(3).max(240) }),
  z.object({ action: z.literal("confirm"), expectedVersion: z.number().int().positive() }),
  z.object({ action: z.literal("cancel"), expectedVersion: z.number().int().positive(), reason: z.string().trim().min(3).max(240) }),
]);

export function effectiveVerifiedPrice(item: { verificationStatus: string; priceAmount: string | null; priceSourceReference: string | null; effectiveFrom: string | null; effectiveUntil: string | null }, today = new Date().toISOString().slice(0, 10)) {
  return item.verificationStatus === "VERIFIED" && item.priceAmount !== null && Boolean(item.priceSourceReference) && Boolean(item.effectiveFrom) && item.effectiveFrom! <= today && (!item.effectiveUntil || item.effectiveUntil >= today);
}

export function hasOverlappingServices(services: Array<{ serviceType: string; serviceCode: string; components?: string[] }>) {
  const seen = new Set<string>();
  for (const service of services) {
    const codes = [service.serviceType === "TEST" ? service.serviceCode : null, ...(service.components ?? [])].filter((code): code is string => Boolean(code));
    for (const code of codes) {
      if (seen.has(code)) return true;
      seen.add(code);
    }
  }
  return false;
}
