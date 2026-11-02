export type LeadAggregate = { key: string; count: number };

export function summarizeLeadAnalytics(rows: LeadAggregate[], dimension: "source" | "status") {
  const allowed = dimension === "source"
    ? new Set(["MANUAL", "WEBSITE", "WALK_IN", "PHONE", "REFERRAL", "PARTNER", "CORPORATE", "WHATSAPP", "CAMPAIGN"])
    : new Set(["NEW", "CONTACTED", "QUALIFIED", "FOLLOW_UP", "CONVERTED", "LOST", "DUPLICATE", "DO_NOT_CONTACT"]);
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!allowed.has(row.key) || !Number.isSafeInteger(row.count) || row.count < 0) continue;
    counts.set(row.key, (counts.get(row.key) ?? 0) + row.count);
  }
  return [...counts].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function conversionRate(total: number, converted: number) {
  if (!Number.isSafeInteger(total) || !Number.isSafeInteger(converted) || total <= 0 || converted < 0 || converted > total) return null;
  return Math.round((converted / total) * 1000) / 10;
}

export function parseAnalyticsDate(value: string | null) {
  if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null;
}
