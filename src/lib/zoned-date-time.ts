const dateFormatterCache = new Map<string, Intl.DateTimeFormat>();
const dateTimeFormatterCache = new Map<string, Intl.DateTimeFormat>();

function dateFormatter(timeZone: string) {
  let formatter = dateFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    dateFormatterCache.set(timeZone, formatter);
  }
  return formatter;
}

function dateKeyAt(instant: Date, timeZone: string) {
  const parts = Object.fromEntries(dateFormatter(timeZone).formatToParts(instant).map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function shiftDateKey(dateKey: string, days: number) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const day = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days));
  return `${day.getUTCFullYear().toString().padStart(4, "0")}-${(day.getUTCMonth() + 1).toString().padStart(2, "0")}-${day.getUTCDate().toString().padStart(2, "0")}`;
}

/** Earliest instant belonging to a local calendar date, including DST-boundary dates. */
function zonedDateStart(dateKey: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const nominal = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  let low = nominal - 36 * 60 * 60_000;
  let high = nominal + 36 * 60 * 60_000;
  try {
    if (dateKeyAt(new Date(low), timeZone) >= dateKey || dateKeyAt(new Date(high), timeZone) < dateKey) return null;
    while (high - low > 1) {
      const middle = Math.floor((low + high) / 2);
      if (dateKeyAt(new Date(middle), timeZone) < dateKey) low = middle;
      else high = middle;
    }
    return dateKeyAt(new Date(high), timeZone) === dateKey ? new Date(high) : null;
  } catch {
    return null;
  }
}

export function zonedWeekRange(now: Date, timeZone: string, weekOffset = 0) {
  try {
    const today = dateKeyAt(now, timeZone);
    const [year, month, day] = today.split("-").map(Number);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    const monday = shiftDateKey(today, -((weekday + 6) % 7) + weekOffset * 7);
    const nextMonday = monday ? shiftDateKey(monday, 7) : null;
    if (!monday || !nextMonday) return null;
    const from = zonedDateStart(monday, timeZone);
    const to = zonedDateStart(nextMonday, timeZone);
    return from && to ? { from, to, monday, nextMonday } : null;
  } catch {
    return null;
  }
}

function dateTimeFormatter(timeZone: string, locale = "en-GB") {
  const key = `${locale}:${timeZone}`;
  let formatter = dateTimeFormatterCache.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale, { timeZone, dateStyle: "medium", timeStyle: "short" });
    dateTimeFormatterCache.set(key, formatter);
  }
  return formatter;
}

export function formatDateTimeInZone(value: string | Date, timeZone: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "Time unavailable";
  try { return dateTimeFormatter(timeZone).format(date); }
  catch { return "Time zone unavailable"; }
}

export function formatDateInZone(value: string | Date, timeZone: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "Date unavailable";
  try { return new Intl.DateTimeFormat("en-GB", { timeZone, dateStyle: "medium" }).format(date); }
  catch { return "Time zone unavailable"; }
}

export function toDateTimeInputInZone(value: string | Date, timeZone: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((part) => [part.type, part.value]));
    return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
  } catch { return ""; }
}

export function localInputToIsoInZone(value: string, timeZone: string) {
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [year, month, day, hour, minute] = match[1].split(/[T:-]/).map(Number);
  const nominal = Date.UTC(year, month - 1, day, hour, minute);
  if (new Date(nominal).toISOString().slice(0, 16) !== match[1]) return null;
  let guess = nominal;
  try {
    const formatter = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(guess)).map((part) => [part.type, part.value]));
      const rendered = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
      const delta = nominal - rendered;
      if (delta === 0) return new Date(guess).toISOString();
      guess += delta;
    }
  } catch { return null; }
  return null;
}
