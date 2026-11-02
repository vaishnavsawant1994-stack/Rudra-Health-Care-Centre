"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IdempotencyAttempt } from "@/lib/idempotency-attempt";

type Centre = { id: string; code: string; name: string };
type Shift = { id: string; staffId: string; shiftType: string; startsAt: string; endsAt: string };
type Staff = { id: string; displayName: string; staffCode: string };
type HandoverEvent = { id: string; eventType: string; actorStaffId: string; recordedAt: string; note?: string; reason?: string };
type Handover = { id: string; outgoingShiftId: string; outgoingStaffId: string; incomingStaffId: string; status: string; versionNumber: number; acknowledgedAt: string | null; createdAt: string; handoverNote: string; history: HandoverEvent[] };
async function readJson<T>(response: Response) { return response.json().catch(() => ({})) as Promise<T>; }

export function ShiftHandoverWorkbench({ staffId }: { staffId: string }) {
  const [centres, setCentres] = useState<Centre[]>([]);
  const [centreId, setCentreId] = useState("");
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [staff, setStaff] = useState<Staff[]>([]);
  const [handovers, setHandovers] = useState<Handover[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [shiftId, setShiftId] = useState("");
  const [incomingStaffId, setIncomingStaffId] = useState("");
  const [handoverNote, setHandoverNote] = useState("");
  const [canManage, setCanManage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading centres…");
  const attempt = useRef(new IdempotencyAttempt());
  const actionAttempts = useRef(new Map<string, IdempotencyAttempt>());

  const load = useCallback(async (selectedCentre: string, selectedPage = page) => {
    if (!selectedCentre) return;
    try {
      const response = await fetch(`/api/roster/handovers?centreId=${encodeURIComponent(selectedCentre)}&page=${selectedPage}`, { cache: "no-store" });
      const body = await readJson<{ error?: string; handovers?: Handover[]; hasMore?: boolean; shifts?: Shift[]; incomingStaff?: Staff[]; canManage?: boolean }>(response);
      if (!response.ok) throw new Error(body.error ?? "handover_load_failed");
      setHandovers(body.handovers ?? []); setShifts(body.shifts ?? []); setStaff(body.incomingStaff ?? []); setCanManage(body.canManage ?? false);
      setHasMore(body.hasMore ?? false);
      setShiftId((current) => (body.shifts ?? []).some((shift) => shift.id === current) ? current : (body.shifts ?? []).find((shift) => shift.staffId === staffId)?.id ?? (body.shifts ?? [])[0]?.id ?? "");
      setMessage((body.handovers?.length || body.shifts?.length) ? "" : "No active shifts or handover records are available for this centre.");
    } catch { setHandovers([]); setHasMore(false); setShifts([]); setMessage("Shift handovers could not be loaded. Check centre access and retry."); }
  }, [staffId, page]);

  useEffect(() => {
    let active = true;
    void fetch("/api/roster/centres", { cache: "no-store" }).then((response) => readJson<{ centres?: Centre[] }>(response)).then((body) => {
      if (!active) return;
      const rows = body.centres ?? []; setCentres(rows);
      if (rows[0]) { setCentreId(rows[0].id); setPage(1); void load(rows[0].id, 1); } else setMessage("No centre is available for your handover permission.");
    }).catch(() => { if (active) setMessage("Centre list is unavailable."); });
    return () => { active = false; };
  }, [load]);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!centreId || !shiftId || !incomingStaffId || handoverNote.trim().length < 3) { setMessage("Select your outgoing shift, the incoming staff member, and enter a handover note."); return; }
    setBusy(true); setMessage("Saving encrypted handover…");
    try {
      const payload = JSON.stringify({ centreId, outgoingShiftId: shiftId, incomingStaffId, handoverNote: handoverNote.trim() });
      const key = await attempt.current.keyFor(payload);
      const response = await fetch("/api/roster/handovers", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: payload });
      const body = await readJson<{ error?: string }>(response);
      if (!response.ok) { if (response.status < 500) attempt.current.clear(); throw new Error(body.error ?? "handover_create_failed"); }
      attempt.current.clear(); setHandoverNote(""); setIncomingStaffId(""); setPage(1); setMessage("Handover saved. The incoming staff member must acknowledge it."); await load(centreId, 1);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Handover save could not be confirmed. Retry without changing the form."); }
    finally { setBusy(false); }
  }

  async function act(handover: Handover, action: "ACKNOWLEDGE" | "CANCEL") {
    const reason = action === "CANCEL" ? window.prompt("Reason for cancelling this handover")?.trim() : undefined;
    if (action === "CANCEL" && (!reason || reason.length < 3)) { setMessage("Enter a cancellation reason of at least 3 characters."); return; }
    setBusy(true);
    try {
      const actionId = `${handover.id}:${action}`;
      const requestAttempt = actionAttempts.current.get(actionId) ?? new IdempotencyAttempt(`rudra:shift-handover:${actionId}`);
      actionAttempts.current.set(actionId, requestAttempt);
      const payload = JSON.stringify({ centreId, expectedVersion: handover.versionNumber, action, reason });
      const key = await requestAttempt.keyFor(payload);
      const response = await fetch(`/api/roster/handovers/${handover.id}`, { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": key }, body: payload });
      const body = await readJson<{ error?: string; handover?: { replayed?: boolean } }>(response);
      if (!response.ok) { if (response.status < 500) { requestAttempt.clear(); actionAttempts.current.delete(actionId); } throw new Error(body.error ?? "handover_action_failed"); }
      requestAttempt.clear(); actionAttempts.current.delete(actionId);
      setMessage(body.handover?.replayed ? "This handover action was already recorded; no duplicate event was added." : action === "ACKNOWLEDGE" ? "Handover acknowledged and recorded." : "Handover cancelled and recorded."); await load(centreId, page);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Handover action failed. Refresh and try again."); }
    finally { setBusy(false); }
  }

  return <div className="workspace-operations">
      <section className="admin-card"><div className="task-toolbar"><div><p className="eyebrow">Front desk and staff continuity</p><h2>Shift handover</h2><p>Handover notes are encrypted. A handover records responsibility acknowledgment; it does not transfer or complete appointments, payments, samples, or tasks automatically.</p></div><label>Centre<select value={centreId} onChange={(event) => { setCentreId(event.target.value); setPage(1); void load(event.target.value, 1); }}><option value="">Select centre</option>{centres.map((centre) => <option value={centre.id} key={centre.id}>{centre.name} ({centre.code})</option>)}</select></label></div>
      {message && <p role="status" aria-live="polite">{message}</p>}
      <p><a href="/branch/operations">Review centre operational queues</a> · <a href="/finance/reconciliation">Review cash reconciliation</a> · <a href="/tasks">Review assigned tasks</a></p>
      {shifts.length > 0 && <form className="admin-form" onSubmit={create}><label>Outgoing shift<select required value={shiftId} onChange={(event) => setShiftId(event.target.value)}>{shifts.map((shift) => <option value={shift.id} key={shift.id}>{shift.shiftType} · {new Date(shift.startsAt).toLocaleString()} – {new Date(shift.endsAt).toLocaleString()} · {shift.staffId === staffId ? "My shift" : "Staff shift"}</option>)}</select></label><label>Incoming staff member<select required value={incomingStaffId} onChange={(event) => setIncomingStaffId(event.target.value)}><option value="">Select recipient</option>{staff.filter((person) => person.id !== shifts.find((shift) => shift.id === shiftId)?.staffId).map((person) => <option value={person.id} key={person.id}>{person.displayName} ({person.staffCode})</option>)}</select></label><label>Pending items and handover note<textarea required minLength={3} maxLength={2000} rows={4} value={handoverNote} onChange={(event) => setHandoverNote(event.target.value)} /><small>Do not enter unnecessary patient or clinical details. This note is encrypted at rest.</small></label><button className="button button-primary" disabled={busy || !shiftId || !incomingStaffId}>{busy ? "Saving…" : "Prepare handover"}</button></form>}
    </section>
    <section className="admin-card"><h2>Handover queue and history</h2>{handovers.length === 0 ? <p>No handovers on this page.</p> : <div className="workspace-grid">{handovers.map((handover) => <article className="admin-card" key={handover.id}><p className="eyebrow">{handover.status} · {new Date(handover.createdAt).toLocaleString()}</p><p>Outgoing: {staff.find((person) => person.id === handover.outgoingStaffId)?.displayName ?? handover.outgoingStaffId}</p><p>Incoming: {staff.find((person) => person.id === handover.incomingStaffId)?.displayName ?? handover.incomingStaffId}</p><p>{handover.handoverNote}</p>{handover.status === "PENDING" && handover.incomingStaffId === staffId && <button className="button button-primary" disabled={busy} onClick={() => void act(handover, "ACKNOWLEDGE")}>Acknowledge receipt</button>}{handover.status === "PENDING" && (handover.outgoingStaffId === staffId || canManage) && <button className="button button-secondary" disabled={busy} onClick={() => void act(handover, "CANCEL")}>Cancel handover</button>}<h3>History</h3><ol>{handover.history.map((entry) => <li key={entry.id}>{entry.eventType} · {new Date(entry.recordedAt).toLocaleString()} {entry.reason ?? entry.note}</li>)}</ol></article>)}</div>}<nav aria-label="Handover history pages" className="task-pagination"><button type="button" className="button button-secondary" disabled={page <= 1 || busy} onClick={() => { const next = Math.max(1, page - 1); setPage(next); void load(centreId, next); }}>Previous</button><span>Page {page}</span><button type="button" className="button button-secondary" disabled={!hasMore || busy} onClick={() => { const next = page + 1; setPage(next); void load(centreId, next); }}>Next</button></nav></section>
  </div>;
}
