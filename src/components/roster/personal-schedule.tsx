"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildRosterCalendarDays } from "@/lib/roster-calendar";
import { formatDateInZone, formatDateTimeInZone, zonedWeekRange } from "@/lib/zoned-date-time";
import { resolveAuthorizedCentreFilter } from "@/lib/authorized-centre-selection";

type Centre = { id: string; code: string; name: string; timeZone: string };
type Shift = { id: string; staffId: string; staffName: string; shiftType: "SCHEDULED" | "UNAVAILABLE"; startsAt: string; endsAt: string; timeZone: string; note: string; versionNumber: number };
async function readBody<T>(response: Response) { return response.json().catch(() => ({})) as Promise<T>; }

export function PersonalSchedule({ staffId, initialCentreId }: { staffId: string; initialCentreId?: string }) {
  const [centres, setCentres] = useState<Centre[]>([]);
  const [centreId, setCentreId] = useState("");
  const [weekOffset, setWeekOffset] = useState(0);
  const [page, setPage] = useState(1);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<"loading-centres" | "loading" | "ready" | "error">("loading-centres");

  const selectedCentre = centres.find((item) => item.id === centreId);
  const range = useMemo(() => selectedCentre ? zonedWeekRange(new Date(), selectedCentre.timeZone, weekOffset) : null, [selectedCentre, weekOffset]);

  const loadCentres = useCallback(async () => {
    await Promise.resolve();
    setState("loading-centres");
    try {
      const response = await fetch("/api/roster/centres", { cache: "no-store" });
      const body = await readBody<{ centres?: Centre[] }>(response);
      if (!response.ok || !Array.isArray(body.centres)) throw new Error("centres_unavailable");
      const rows = body.centres;
      setCentres(rows);
      setCentreId((current) => current || resolveAuthorizedCentreFilter(rows, initialCentreId) || rows[0]?.id || "");
      setState(rows.length ? "loading" : "ready");
    } catch { setCentres([]); setCentreId(""); setState("error"); }
  }, [initialCentreId]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => active ? loadCentres() : undefined);
    return () => { active = false; };
  }, [loadCentres]);

  const refresh = useCallback(async () => {
    if (!centreId || !range) { setShifts([]); setHasMore(false); return; }
    await Promise.resolve();
    setState("loading");
    try {
      const query = new URLSearchParams({ centreId, staffId, from: range.from.toISOString(), to: range.to.toISOString(), page: String(page) });
      const response = await fetch(`/api/roster?${query}`, { cache: "no-store" });
      const body = await readBody<{ shifts?: Shift[]; hasMore?: boolean }>(response);
      if (!response.ok || !Array.isArray(body.shifts)) throw new Error("schedule_unavailable");
      setShifts(body.shifts); setHasMore(body.hasMore ?? false); setState("ready");
    } catch { setShifts([]); setHasMore(false); setState("error"); }
  }, [centreId, staffId, range, page]);

  useEffect(() => {
    let active = true;
    void Promise.resolve().then(() => active ? refresh() : undefined);
    return () => { active = false; };
  }, [refresh]);

  const days = useMemo(() => selectedCentre && range ? buildRosterCalendarDays(shifts, range.from, selectedCentre.timeZone) : [], [selectedCentre, range, shifts]);

  return <div className="workspace-grid">
    <section className="admin-card">
      <div className="task-toolbar">
        <div><p className="eyebrow">Personal schedule</p><h2>My shifts and availability</h2><p>Shows only roster entries returned for your staff account. A scheduled shift is not an attendance record; availability warnings do not change assignments.</p></div>
        <label>Centre<select value={centreId} onChange={(event) => { setCentreId(event.target.value); setPage(1); }} disabled={state === "loading-centres" || centres.length === 0}><option value="">Choose centre</option>{centres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name} ({centre.code})</option>)}</select></label>
      </div>
      <div className="task-actions" aria-label="Schedule week navigation">
        <button type="button" className="button button-secondary" disabled={state === "loading" || !selectedCentre} onClick={() => { setPage(1); setWeekOffset((value) => value - 1); }}>Previous week</button>
        <strong>{selectedCentre && range ? `${formatDateInZone(range.from, selectedCentre.timeZone)} – ${formatDateInZone(new Date(range.to.getTime() - 1), selectedCentre.timeZone)}` : "Choose an authorized centre"}</strong>
        <button type="button" className="button button-secondary" disabled={state === "loading" || !selectedCentre} onClick={() => { setPage(1); setWeekOffset((value) => value + 1); }}>Next week</button>
      </div>
      {state === "loading-centres" && <p role="status">Loading authorized centres…</p>}
      {state === "loading" && <p role="status">Loading your schedule…</p>}
      {state === "error" && <div role="alert"><p>Your schedule could not be loaded. No shifts or availability have been assumed.</p><button type="button" className="button button-secondary" onClick={() => { setState("loading-centres"); void loadCentres(); }}>Retry</button></div>}
      {state === "ready" && centres.length === 0 && <p role="status">No centre is available in your roster access scope.</p>}
      {state === "ready" && selectedCentre && shifts.length === 0 && <p role="status">No shifts or unavailability are recorded for you this week.</p>}
      {state === "ready" && selectedCentre && shifts.length > 0 && <div className="roster-calendar" aria-label="My weekly schedule">{days.map((day) => <section className="roster-calendar-day" key={day.key} aria-labelledby={`personal-roster-${day.key}`}><h3 id={`personal-roster-${day.key}`}>{day.label}</h3>{day.entries.length ? <ul>{day.entries.map((entry) => <li className={entry.shiftType === "UNAVAILABLE" ? "roster-calendar-entry is-unavailable" : "roster-calendar-entry"} key={entry.id}><strong>{entry.shiftType === "UNAVAILABLE" ? "Unavailable" : "Scheduled shift"}</strong><time dateTime={entry.startsAt}>{formatDateTimeInZone(entry.startsAt, selectedCentre.timeZone)}</time><time dateTime={entry.endsAt}>Until {formatDateTimeInZone(entry.endsAt, selectedCentre.timeZone)}</time>{entry.note && <small>{entry.note}</small>}</li>)}</ul> : <p>No roster entries.</p>}</section>)}</div>}
      {state === "ready" && shifts.length > 0 && <nav aria-label="Personal schedule pages" className="task-pagination"><button type="button" className="button button-secondary" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous entries</button><span>Page {page}</span><button type="button" className="button button-secondary" disabled={!hasMore} onClick={() => setPage((value) => value + 1)}>More entries</button></nav>}
    </section>
  </div>;
}
