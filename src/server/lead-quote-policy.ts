import { z } from "zod";
import { effectiveVerifiedPrice, hasOverlappingServices } from "@/server/order-policy";

export const leadQuoteCreateSchema = z.object({
  catalogueVersionIds: z.array(z.uuid()).min(1).max(50),
  visitType: z.enum(["CENTRE", "HOME_COLLECTION"]),
  homeVisitFeePaise: z.number().int().refine((value) => [0, 7500, 9900, 15000].includes(value), "Choose an approved listed home-visit fee."),
  homeVisitFeeReason: z.string().trim().max(240).optional(),
}).strict()
  .refine((value) => new Set(value.catalogueVersionIds).size === value.catalogueVersionIds.length, "Duplicate catalogue selections are not allowed.")
  .refine((value) => value.visitType === "HOME_COLLECTION" || value.homeVisitFeePaise === 0, { path: ["homeVisitFeePaise"], message: "Centre visits cannot include a home-visit fee." })
  .refine((value) => !(value.visitType === "HOME_COLLECTION" && value.homeVisitFeePaise === 0) || Boolean(value.homeVisitFeeReason?.trim()), { path: ["homeVisitFeeReason"], message: "Record a reason when waiving the home-visit fee." });

export type QuotePriceRow = {
  verificationStatus: string; priceAmount: string | null; priceSourceReference: string | null;
  effectiveFrom: string | null; effectiveUntil: string | null; currency: string;
};

/** Convert a PostgreSQL numeric price to integer paise without floating point. */
export function cataloguePriceToPaise(price: string | null) {
  if (!price || !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(price)) throw new Error("catalogue_price_invalid");
  const [rupees, fraction = ""] = price.split(".");
  const paise = Number(rupees) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(paise) || paise < 0) throw new Error("catalogue_price_invalid");
  return paise;
}

export function quoteableVerifiedPrice(row: QuotePriceRow, today = new Date().toISOString().slice(0, 10)) {
  if (row.currency !== "INR" || !effectiveVerifiedPrice(row, today)) return false;
  try { cataloguePriceToPaise(row.priceAmount); return true; } catch { return false; }
}

export function localDateForTimeZone(date: Date, timeZone: string) {
  if (!Number.isFinite(date.getTime())) throw new Error("quote_date_invalid");
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    if (!values.year || !values.month || !values.day) throw new Error();
    return `${values.year}-${values.month}-${values.day}`;
  } catch { throw new Error("quote_timezone_invalid"); }
}

export function quoteSelectionHasOverlap(services: Array<{ serviceType: string; serviceCode: string; components: string[] }>) {
  return hasOverlappingServices(services);
}

export function buildInternalQuoteTotal(diagnosticPricesPaise: number[], homeVisitFeePaise: number) {
  if (![0, 7500, 9900, 15000].includes(homeVisitFeePaise) || diagnosticPricesPaise.some((value) => !Number.isSafeInteger(value) || value < 0)) throw new Error("quote_amount_invalid");
  const diagnosticTotalPaise = diagnosticPricesPaise.reduce((total, value) => total + value, 0);
  const totalPaise = diagnosticTotalPaise + homeVisitFeePaise;
  if (!Number.isSafeInteger(diagnosticTotalPaise) || !Number.isSafeInteger(totalPaise)) throw new Error("quote_amount_invalid");
  return { diagnosticTotalPaise, homeVisitFeePaise, totalPaise };
}
