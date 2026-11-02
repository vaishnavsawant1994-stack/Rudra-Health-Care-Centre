export type RosterCalendarEntry = {
  id: string;
  staffId: string;
  staffName: string;
  staffCode?: string;
  shiftType: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  note: string;
};

export type RosterCalendarDay = { key: string; label: string; entries: RosterCalendarEntry[] };

function localDateKey(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(value);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addCalendarDays(key: string, days: number) {
  const [year, month, day] = key.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days, 12));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function buildRosterCalendarDays(entries: readonly RosterCalendarEntry[], weekStart: Date, timeZone: string): RosterCalendarDay[] {
  const firstDay = localDateKey(weekStart, timeZone);
  return Array.from({ length: 7 }, (_, index) => {
    const key = addCalendarDays(firstDay, index);
    const [year, month, day] = key.split("-").map(Number);
    const labelDate = new Date(Date.UTC(year, month - 1, day, 12));
    const label = new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", weekday: "short", day: "2-digit", month: "short" }).format(labelDate);
    const dayEntries = entries.filter((entry) => {
      const start = new Date(entry.startsAt);
      const end = new Date(entry.endsAt);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start) return false;
      const entryStartDay = localDateKey(start, timeZone);
      const entryEndDay = localDateKey(new Date(end.getTime() - 1), timeZone);
      return key >= entryStartDay && key <= entryEndDay;
    }).sort((left, right) => Date.parse(left.startsAt) - Date.parse(right.startsAt) || left.staffName.localeCompare(right.staffName) || left.id.localeCompare(right.id));
    return { key, label, entries: dayEntries };
  });
}
