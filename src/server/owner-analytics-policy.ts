import { z } from "zod";

export const ownerAnalyticsFilterSchema = z.object({ from: z.iso.date(), to: z.iso.date(), centreId: z.uuid().optional() }).strict().refine((value) => value.to >= value.from, "End date must not precede start date.").refine((value) => Date.parse(`${value.to}T00:00:00Z`) - Date.parse(`${value.from}T00:00:00Z`) <= 366 * 24 * 60 * 60 * 1000, "Date range cannot exceed 367 calendar days.");

export function ownerAnalyticsBounds(from: string, to: string) {
  const start = new Date(`${from}T00:00:00.000Z`);
  const end = new Date(`${to}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
}
