export type RelationshipAttributionRange = { from: Date | null; toExclusive: Date | null };

/** Accepts inclusive ISO calendar dates and converts the end to a UTC-exclusive bound. */
export function parseRelationshipAttributionRange(fromRaw: string | null | undefined, toRaw: string | null | undefined): RelationshipAttributionRange | null {
  if (!fromRaw && !toRaw) return { from: null, toExclusive: null };
  if (!fromRaw || !toRaw || !/^\d{4}-\d{2}-\d{2}$/.test(fromRaw) || !/^\d{4}-\d{2}-\d{2}$/.test(toRaw)) return null;
  const from = new Date(`${fromRaw}T00:00:00.000Z`);
  const inclusiveTo = new Date(`${toRaw}T00:00:00.000Z`);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(inclusiveTo.getTime()) || from.toISOString().slice(0, 10) !== fromRaw || inclusiveTo.toISOString().slice(0, 10) !== toRaw || from > inclusiveTo) return null;
  const toExclusive = new Date(inclusiveTo.getTime() + 86_400_000);
  if (toExclusive.getTime() - from.getTime() > 366 * 86_400_000) return null;
  return { from, toExclusive };
}
