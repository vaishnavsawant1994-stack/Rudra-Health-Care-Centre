"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { IdempotencyAttempt } from "@/lib/idempotency-attempt";
import { buildRosterCalendarDays } from "@/lib/roster-calendar";
import { formatDateInZone, formatDateTimeInZone, localInputToIsoInZone, toDateTimeInputInZone, zonedWeekRange } from "@/lib/zoned-date-time";
import { rosterConflictEscalationSourceType } from "@/server/staff-roster-policy";
import { escalationDeepLinkHref } from "@/lib/escalation-deep-link";
import { resolveAuthorizedCentreFilter } from "@/lib/authorized-centre-selection";
import type { PermissionGrant } from "@/server/permissions";
import { canAssignAppointmentsInCentre, canAssignCollectionsInCentre, canCreateEscalationInCentre, canManageRosterInCentre } from "@/lib/roster-permissions";
import { fetchRosterWorkload, type RosterDailyWorkload, type RosterWorkloadRow } from "./roster-workload-client";

type Centre = { id: string; code: string; name: string; timeZone: string };
type Staff = { id: string; displayName: string; staffCode: string };
type Shift = { id: string; centreId: string; staffId: string; staffName: string; shiftType: string; startsAt: string; endsAt: string; timeZone: string; note: string; versionNumber: number };
type ShiftHistoryEvent = { id: string; eventType: string; actorName: string; recordedAt: string; reason?: string | null; startsAt?: string; endsAt?: string; shiftType?: string; note?: string };
type Workload = RosterWorkloadRow;
type DailyWorkload = RosterDailyWorkload;
type WorkConflict = { id: string; kind: "APPOINTMENT" | "COLLECTION"; label: string; staffId: string; staffName: string; startsAt: string; endsAt: string; versionNumber: number; expectedUpdatedAt: string | null; advisoryFlags: string[]; relatedEscalationId?: string };
type AssignmentEvent = { id: string; workType: "APPOINTMENT" | "COLLECTION"; workReference: string; action: string; previousStaffName: string | null; staffName: string | null; actorName: string; recordedAt: string };
async function body<T>(response: Response) { return response.json().catch(() => ({})) as Promise<T>; }
const weekFrom = (offset = 0) => { const date = new Date(); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - ((date.getDay() + 6) % 7) + offset * 7); return date; };
const localInput = (date: Date) => { const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16); };

export function RosterWorkbench({ grants, sessionStaffId, initialCentreId }: { grants: readonly PermissionGrant[]; sessionStaffId?: string; initialCentreId?: string }) {
  const [centres, setCentres] = useState<Centre[]>([]); const [staff, setStaff] = useState<Staff[]>([]); const [shifts, setShifts] = useState<Shift[]>([]);
  const [shiftPage, setShiftPage] = useState(1); const [shiftsHaveMore, setShiftsHaveMore] = useState(false);
  const [workloadResult, setWorkloadResult] = useState<{ requestKey: string; status: "ready" | "error"; staff: Workload[]; dailyWorkload: DailyWorkload[] } | null>(null);
  const [workloadRefresh, setWorkloadRefresh] = useState(0);
  const [conflicts, setConflicts] = useState<WorkConflict[]>([]);
  const [conflictsHaveMore, setConflictsHaveMore] = useState(false); const [conflictPage, setConflictPage] = useState(1);
  const [assignmentEvents, setAssignmentEvents] = useState<AssignmentEvent[]>([]); const [assignmentHistoryPage, setAssignmentHistoryPage] = useState(1); const [assignmentHistoryHasMore, setAssignmentHistoryHasMore] = useState(false); const [assignmentHistoryMessage, setAssignmentHistoryMessage] = useState("Choose a centre to review assignment history."); const [assignmentHistoryRefresh, setAssignmentHistoryRefresh] = useState(0);
  const [escalating, setEscalating] = useState<string | null>(null);
  const [escalatedWork, setEscalatedWork] = useState<Set<string>>(() => new Set());
  const [escalationDueAt, setEscalationDueAt] = useState("");
  const [reassignStaff, setReassignStaff] = useState<Record<string, string>>({}); const [reassignReason, setReassignReason] = useState<Record<string, string>>({}); const [reassigning, setReassigning] = useState<string | null>(null);
  const escalationKeys = useRef(new Map<string, { key: string; dueAt: string }>());
  const createShiftAttempt = useRef(new IdempotencyAttempt("rudra:roster:create-shift"));
  const shiftActionAttempts = useRef(new Map<string, IdempotencyAttempt>());
  const assignmentAttempts = useRef(new Map<string, IdempotencyAttempt>());
  const [weekOffset, setWeekOffset] = useState(0);
  const [viewMode, setViewMode] = useState<"CALENDAR" | "LIST">("CALENDAR");
  const [centreId, setCentreId] = useState(""); const [staffId, setStaffId] = useState(""); const [shiftType, setShiftType] = useState("SCHEDULED");
  const [startsAt, setStartsAt] = useState(() => localInput(weekFrom())); const [endsAt, setEndsAt] = useState(() => { const d = weekFrom(); d.setHours(17, 0); return localInput(d); });
  const [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Kolkata"); const [note, setNote] = useState(""); const [message, setMessage] = useState("Loading roster…"); const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<Shift | null>(null); const [editStarts, setEditStarts] = useState(""); const [editEnds, setEditEnds] = useState(""); const [editNote, setEditNote] = useState("");
  const [historyShift, setHistoryShift] = useState<Shift | null>(null); const [history, setHistory] = useState<ShiftHistoryEvent[]>([]); const [historyState, setHistoryState] = useState<"idle" | "loading" | "error">("idle");
  const selectedCentre = centres.find((item) => item.id === centreId) ?? null;
  const canManage = Boolean(centreId && canManageRosterInCentre(grants, centreId));
  const canEscalate = Boolean(centreId && canCreateEscalationInCentre(grants, centreId));
  const canAssignAppointments = Boolean(centreId && canAssignAppointmentsInCentre(grants, centreId));
  const canAssignCollections = Boolean(centreId && canAssignCollectionsInCentre(grants, centreId));
  const weekRange = selectedCentre ? zonedWeekRange(new Date(), selectedCentre.timeZone, weekOffset) : null;
  const calendarDays = useMemo(() => selectedCentre && weekRange ? buildRosterCalendarDays(shifts, weekRange.from, selectedCentre.timeZone) : [], [shifts, selectedCentre, weekRange]);
  const workloadRequestKey = centreId ? `${centreId}:${weekOffset}:${workloadRefresh}` : "";
  const currentWorkloadResult = workloadResult?.requestKey === workloadRequestKey ? workloadResult : null;
  const workloadState = !centreId ? "idle" : currentWorkloadResult?.status ?? "loading";
  const workload = currentWorkloadResult?.staff ?? [];
  const dailyWorkload = currentWorkloadResult?.dailyWorkload ?? [];

  async function load(selectedCentre = centreId, selectedPage = shiftPage) {
    if (!selectedCentre) { setShifts([]); setShiftsHaveMore(false); return; }
    const range = centres.find((item) => item.id === selectedCentre)?.timeZone;
    const bounds = range ? zonedWeekRange(new Date(), range, weekOffset) : null;
    if (!bounds) return;
    const { from: fromDate, to: toDate } = bounds;
    try {
      const response = await fetch(`/api/roster?centreId=${encodeURIComponent(selectedCentre)}&from=${encodeURIComponent(fromDate.toISOString())}&to=${encodeURIComponent(toDate.toISOString())}&page=${selectedPage}`, { cache: "no-store" });
      const result = await body<{ shifts?: Shift[]; hasMore?: boolean }>(response); if (!response.ok) throw new Error(); setShifts(result.shifts ?? []); setShiftsHaveMore(result.hasMore ?? false); setMessage(result.shifts?.length ? "" : "No shifts or unavailability recorded for this week.");
    } catch { setShifts([]); setShiftsHaveMore(false); setMessage("Roster could not be loaded. Check your centre access and retry."); }
  }

  async function viewHistory(shift: Shift) {
    setHistoryShift(shift); setHistory([]); setHistoryState("loading");
    try {
      const response = await fetch(`/api/roster/${encodeURIComponent(shift.id)}`, { cache: "no-store" });
      const result = await body<{ history?: ShiftHistoryEvent[] }>(response);
      if (!response.ok) throw new Error("history_unavailable");
      setHistory(result.history ?? []); setHistoryState("idle");
    } catch { setHistoryState("error"); }
  }

  useEffect(() => {
    let active = true;
    fetch("/api/roster/centres", { cache: "no-store" }).then((r) => body<{ centres?: Centre[] }>(r)).then((data) => { if (!active) return; const rows = data.centres ?? []; setCentres(rows); const selectedId = resolveAuthorizedCentreFilter(rows, initialCentreId) || rows[0]?.id; const selected = rows.find((centre) => centre.id === selectedId); if (selected) { const today = toDateTimeInputInZone(new Date(), selected.timeZone).slice(0, 10); setCentreId(selected.id); setAssignmentHistoryMessage("Loading assignment history…"); setTimeZone(selected.timeZone); setStartsAt(`${today}T09:00`); setEndsAt(`${today}T17:00`); } }).catch(() => { if (active) setMessage("Centre list is unavailable."); });
    return () => { active = false; };
  }, [initialCentreId]);
  useEffect(() => {
    if (!centreId) return;
    let active = true;
    const zone = centres.find((item) => item.id === centreId)?.timeZone; const bounds = zone ? zonedWeekRange(new Date(), zone, weekOffset) : null;
    if (!bounds) return;
    const { from: fromDate, to: toDate } = bounds;
    fetch(`/api/roster?centreId=${encodeURIComponent(centreId)}&from=${encodeURIComponent(fromDate.toISOString())}&to=${encodeURIComponent(toDate.toISOString())}&page=${shiftPage}`, { cache: "no-store" }).then(async (response) => ({ response, data: await body<{ shifts?: Shift[]; hasMore?: boolean }>(response) })).then(({ response, data }) => { if (!active) return; if (!response.ok) throw new Error(); setShifts(data.shifts ?? []); setShiftsHaveMore(data.hasMore ?? false); setMessage(data.shifts?.length ? "" : "No shifts or unavailability recorded for this week."); }).catch(() => { if (active) { setShifts([]); setShiftsHaveMore(false); setMessage("Roster could not be loaded. Check your centre access and retry."); } });
    return () => { active = false; };
  }, [centreId, weekOffset, shiftPage, centres]);
  useEffect(() => {
    if (!centreId) return;
    let active = true;
    const zone = centres.find((item) => item.id === centreId)?.timeZone; const bounds = zone ? zonedWeekRange(new Date(), zone, weekOffset) : null;
    if (!bounds) return;
    const { from: fromDate, to: toDate } = bounds;
    fetch(`/api/roster/conflicts?centreId=${encodeURIComponent(centreId)}&from=${encodeURIComponent(fromDate.toISOString())}&to=${encodeURIComponent(toDate.toISOString())}&page=${conflictPage}`, { cache: "no-store" }).then(async (response) => ({ response, data: await body<{ conflicts?: WorkConflict[]; hasMore?: boolean }>(response) })).then(({ response, data }) => { if (!active) return; if (!response.ok) throw new Error(); setConflicts(data.conflicts ?? []); setConflictsHaveMore(data.hasMore ?? false); }).catch(() => { if (active) { setConflicts([]); setConflictsHaveMore(false); } });
    return () => { active = false; };
  }, [centreId, weekOffset, conflictPage, centres]);
  useEffect(() => {
    if (!centreId) return;
    let active = true;
    const zone = centres.find((item) => item.id === centreId)?.timeZone; const bounds = zone ? zonedWeekRange(new Date(), zone, weekOffset) : null;
    if (!bounds) return;
    const { from: fromDate, to: toDate } = bounds;
    fetch(`/api/roster/assignment-history?centreId=${encodeURIComponent(centreId)}&from=${encodeURIComponent(fromDate.toISOString())}&to=${encodeURIComponent(toDate.toISOString())}&page=${assignmentHistoryPage}`, { cache: "no-store" })
      .then(async (response) => ({ response, data: await body<{ events?: AssignmentEvent[]; hasMore?: boolean }>(response) }))
      .then(({ response, data }) => { if (!active) return; if (!response.ok) throw new Error(); setAssignmentEvents(data.events ?? []); setAssignmentHistoryHasMore(data.hasMore ?? false); setAssignmentHistoryMessage(data.events?.length ? "" : "No assignment changes were recorded in this week within your access scope."); })
      .catch(() => { if (active) { setAssignmentEvents([]); setAssignmentHistoryHasMore(false); setAssignmentHistoryMessage("Assignment history is unavailable in your permission scope. No private reasons or patient details are shown here."); } });
    return () => { active = false; };
  }, [centreId, weekOffset, assignmentHistoryPage, assignmentHistoryRefresh, centres]);
  useEffect(() => {
    if (!centreId) return;
    let active = true;
    const zone = centres.find((item) => item.id === centreId)?.timeZone; const bounds = zone ? zonedWeekRange(new Date(), zone, weekOffset) : null;
    if (!bounds) return;
    const { from: fromDate, to: toDate } = bounds;
    const requestKey = `${centreId}:${weekOffset}:${workloadRefresh}`;
    fetchRosterWorkload(centreId, fromDate, toDate).then((data) => { if (active) setWorkloadResult({ requestKey, status: "ready", staff: data.staff, dailyWorkload: data.dailyWorkload }); }).catch(() => { if (active) setWorkloadResult({ requestKey, status: "error", staff: [], dailyWorkload: [] }); });
    return () => { active = false; };
  }, [centreId, weekOffset, centres, workloadRefresh]);
  useEffect(() => {
    if (!canManage || !centreId) return;
    let active = true;
    fetch(`/api/roster/staff?centreId=${encodeURIComponent(centreId)}`, { cache: "no-store" }).then((r) => body<{ staff?: Staff[] }>(r)).then((data) => { if (active) setStaff(data.staff ?? []); }).catch(() => { if (active) setStaff([]); });
    return () => { active = false; };
  }, [canManage, centreId]);
  useEffect(() => {
    const refreshDueDate = () => setEscalationDueAt(new Date(Date.now() + 24 * 60 * 60_000).toISOString());
    refreshDueDate();
    const timer = window.setInterval(refreshDueDate, 60_000);
    return () => window.clearInterval(timer);
  }, [initialCentreId]);

  function selectCentre(nextCentreId: string) {
    setShifts([]); setStaff([]); setConflicts([]); setAssignmentEvents([]); setAssignmentHistoryMessage("Loading assignment history…"); setAssignmentHistoryPage(1); setShiftPage(1); setConflictPage(1); setCentreId(nextCentreId); setWorkloadResult(null);
    const nextCentre = centres.find((item) => item.id === nextCentreId);
    if (!nextCentre) return;
    const today = toDateTimeInputInZone(new Date(), nextCentre.timeZone).slice(0, 10);
    setTimeZone(nextCentre.timeZone); setStartsAt(`${today}T09:00`); setEndsAt(`${today}T17:00`);
  }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!centreId || !staffId) return; setBusy(true); setMessage("Saving roster entry…");
    try {
      const startIso = localInputToIsoInZone(startsAt, timeZone); const endIso = localInputToIsoInZone(endsAt, timeZone);
      if (!startIso || !endIso) { setMessage("Enter valid centre-local times. A time skipped by a daylight-saving change cannot be scheduled."); return; }
      const payload = JSON.stringify({ centreId, staffId, shiftType, startsAt: startIso, endsAt: endIso, timeZone, note });
      const response = await fetch("/api/roster", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": await createShiftAttempt.current.keyFor(payload) }, body: payload });
      const result = await body<{ error?: string }>(response);
      if (!response.ok) { if (response.status < 500) createShiftAttempt.current.clear(); setMessage(result.error === "schedule_conflict" ? "This staff member already has an overlapping shift or unavailability." : result.error === "centre_timezone_mismatch" ? "The roster timezone changed. Refresh the centre list before saving." : "Roster entry was not saved. Verify permissions and dates."); return; }
      createShiftAttempt.current.clear();
      setNote(""); setShiftPage(1); setMessage("Roster entry saved."); await load(centreId, 1);
    } catch { setMessage("Roster service is unavailable; no success was recorded."); } finally { setBusy(false); }
  }

  async function cancel(shift: Shift) {
    const reason = window.prompt("Reason for cancelling this roster entry"); if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    const attemptId = `${shift.id}:CANCEL`; const attempt = shiftActionAttempts.current.get(attemptId) ?? new IdempotencyAttempt(`rudra:roster:${attemptId}`); shiftActionAttempts.current.set(attemptId, attempt);
    try { const payload = JSON.stringify({ expectedVersion: shift.versionNumber, action: "CANCEL", reason: reason.trim() }); const response = await fetch(`/api/roster/${shift.id}`, { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": await attempt.keyFor(payload) }, body: payload }); const result = await body<{ error?: string; shift?: { replayed?: boolean } }>(response); if (!response.ok) { if (response.status < 500) { attempt.clear(); shiftActionAttempts.current.delete(attemptId); } setMessage("Roster entry changed or could not be cancelled. Refresh and try again."); return; } attempt.clear(); shiftActionAttempts.current.delete(attemptId); setMessage(result.shift?.replayed ? "The prior cancellation was already saved." : "Roster entry cancelled."); await load(); }
    catch { setMessage("Roster cancellation could not be confirmed. Retry the same action to safely check whether it was recorded."); } finally { setBusy(false); }
  }
  function beginEdit(shift: Shift) { setEditing(shift); setEditStarts(toDateTimeInputInZone(shift.startsAt, shift.timeZone)); setEditEnds(toDateTimeInputInZone(shift.endsAt, shift.timeZone)); setEditNote(shift.note); }
  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return; setBusy(true);
    try {
      const startIso = localInputToIsoInZone(editStarts, editing.timeZone); const endIso = localInputToIsoInZone(editEnds, editing.timeZone);
      if (!startIso || !endIso) { setMessage("Enter valid centre-local times. A time skipped by a daylight-saving change cannot be scheduled."); return; }
      const attemptId = `${editing.id}:UPDATE`; const attempt = shiftActionAttempts.current.get(attemptId) ?? new IdempotencyAttempt(`rudra:roster:${attemptId}`); shiftActionAttempts.current.set(attemptId, attempt);
      const payload = JSON.stringify({ expectedVersion: editing.versionNumber, action: "UPDATE", startsAt: startIso, endsAt: endIso, note: editNote });
      const response = await fetch(`/api/roster/${editing.id}`, { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": await attempt.keyFor(payload) }, body: payload });
      const result = await body<{ error?: string; shift?: { replayed?: boolean } }>(response);
      if (!response.ok) { if (response.status < 500) { attempt.clear(); shiftActionAttempts.current.delete(attemptId); } setMessage(result.error === "schedule_conflict" ? "This change overlaps another shift or unavailability." : "Roster entry changed or could not be updated. Refresh and retry."); return; }
      attempt.clear(); shiftActionAttempts.current.delete(attemptId); setEditing(null); setMessage(result.shift?.replayed ? "The prior roster update was already saved." : "Roster entry updated."); await load();
    } catch { setMessage("Roster update could not be confirmed. Retry the unchanged action to safely check whether it was recorded."); } finally { setBusy(false); }
  }

  async function escalateConflict(conflict: WorkConflict) {
    if (!centreId || !sessionStaffId || !canEscalate) return;
    const keyId = `${conflict.kind}:${conflict.id}`;
    const pending = escalationKeys.current.get(keyId) ?? { key: crypto.randomUUID(), dueAt: escalationDueAt };
    if (!pending.dueAt) { setMessage("Escalation due date is being prepared; try again in a moment."); return; }
    escalationKeys.current.set(keyId, pending);
    setEscalating(keyId); setMessage("Creating a review escalation…");
    try {
      const response = await fetch("/api/escalations", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": pending.key },
        body: JSON.stringify({ centreId, source: { type: rosterConflictEscalationSourceType(conflict.kind), id: conflict.id }, title: `Review advisory schedule conflict for ${conflict.label}`, description: `Review the ${conflict.advisoryFlags.map((flag) => flag.toLowerCase().replaceAll("_", " ")).join(", ")} advisory and update the authoritative roster or assignment if needed. This escalation does not itself change or resolve the assignment.`, severity: "MODERATE", priority: "NORMAL", assignedOwnerStaffId: sessionStaffId, dueAt: pending.dueAt, deduplicateOpenSource: true }),
      });
      const result = await body<{ error?: string; escalation?: { alreadyOpen?: boolean } }>(response);
      if (!response.ok) throw new Error(result.error ?? "escalation_creation_failed");
      setEscalatedWork((current) => new Set(current).add(keyId));
      setMessage(result.escalation?.alreadyOpen ? "An open review escalation already exists for this work item; no duplicate was created." : "Review escalation created and linked to the work item. The advisory remains until the source schedule or assignment is changed.");
    } catch (error) {
      setMessage(error instanceof Error ? `Escalation was not confirmed: ${error.message}. Retry uses the same request key.` : "Escalation was not confirmed. Retry is safe.");
    } finally { setEscalating(null); }
  }

  async function reassignConflict(conflict: WorkConflict) {
    const keyId = `${conflict.kind}:${conflict.id}`; const nextStaffId = reassignStaff[keyId]; const reason = reassignReason[keyId]?.trim();
    if (!canManage || !nextStaffId || !reason || reason.length < 3) { setMessage("Choose an authorized staff member and enter a reason of at least 3 characters."); return; }
    setReassigning(keyId); setMessage("Updating the assignment…");
    try {
      const isAppointment = conflict.kind === "APPOINTMENT";
      const payload = JSON.stringify(isAppointment
          ? { expectedUpdatedAt: conflict.expectedUpdatedAt, assignedStaffId: nextStaffId, reason }
          : { expectedVersion: conflict.versionNumber, action: "assign", staffUserId: nextStaffId, reason });
      const attempt = assignmentAttempts.current.get(keyId) ?? new IdempotencyAttempt(`rudra:roster-assignment:${keyId}`);
      assignmentAttempts.current.set(keyId, attempt);
      const idempotencyKey = await attempt.keyFor(payload);
      const response = await fetch(isAppointment ? `/api/appointments/${conflict.id}` : `/api/collections/${conflict.id}`, {
        method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: payload,
      });
      const result = await body<{ error?: string; replayed?: boolean }>(response);
      if (!response.ok) {
        if (response.status < 500) { attempt.clear(); assignmentAttempts.current.delete(keyId); }
        const messages: Record<string, string> = { staff_time_conflict: "That staff member has an overlapping appointment.", staff_schedule_conflict: "That staff member has an overlapping collection or appointment.", version_conflict: "The collection changed. Refresh the roster and try again.", appointment_changed_refresh_required: "The appointment changed. Refresh the roster and try again.", invalid_assignee: "That staff member is not eligible for this appointment.", collector_not_authorized: "That staff member is not authorized for collection work.", appointment_already_checked_in: "This appointment has already been checked in and cannot be reassigned here.", idempotency_conflict: "This request key was used for a different assignment. Refresh the roster before retrying." };
        throw new Error(messages[result.error ?? ""] ?? "Assignment was not changed. Check your access and refresh the roster.");
      }
      attempt.clear(); assignmentAttempts.current.delete(keyId);
      setReassignReason((current) => ({ ...current, [keyId]: "" })); setReassignStaff((current) => ({ ...current, [keyId]: "" }));
      setMessage(result.replayed ? "The prior assignment was already saved; no duplicate history event was created." : "Assignment updated in its operational record; history and audit were recorded.");
      setAssignmentHistoryMessage("Refreshing assignment history…"); setAssignmentHistoryRefresh((value) => value + 1);
      const bounds = selectedCentre ? zonedWeekRange(new Date(), selectedCentre.timeZone, weekOffset) : null;
      if (!bounds) throw new Error("Centre timezone is unavailable; refresh the roster before resolving this advisory.");
      const responseQueue = await fetch(`/api/roster/conflicts?centreId=${encodeURIComponent(centreId)}&from=${encodeURIComponent(bounds.from.toISOString())}&to=${encodeURIComponent(bounds.to.toISOString())}&page=${conflictPage}`, { cache: "no-store" });
      const queue = await body<{ conflicts?: WorkConflict[]; hasMore?: boolean }>(responseQueue); if (responseQueue.ok) { setConflicts(queue.conflicts ?? []); setConflictsHaveMore(queue.hasMore ?? false); }
      await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Assignment was not confirmed. Retry the unchanged assignment to safely check whether it was saved."); }
    finally { setReassigning(null); }
  }

  return <>
    <section className="admin-card"><div className="task-toolbar"><div><p className="eyebrow">Weekly schedule</p><h2>Staff roster and availability</h2><p>Times and week boundaries use the selected centre timezone. Schedule conflicts are checked before saving. This is a roster record, not attendance or payroll.</p><div className="task-actions"><button type="button" className="button button-secondary" onClick={() => { setShiftPage(1); setConflictPage(1); setAssignmentHistoryPage(1); setAssignmentEvents([]); setAssignmentHistoryMessage("Loading assignment history…"); setWeekOffset((value) => value - 1); }}>Previous week</button><strong>{selectedCentre && weekRange ? `${formatDateInZone(weekRange.from, selectedCentre.timeZone)} – ${formatDateInZone(new Date(weekRange.to.getTime() - 1), selectedCentre.timeZone)}` : "Choose a centre"}</strong><button type="button" className="button button-secondary" onClick={() => { setShiftPage(1); setConflictPage(1); setAssignmentHistoryPage(1); setAssignmentEvents([]); setAssignmentHistoryMessage("Loading assignment history…"); setWeekOffset((value) => value + 1); }}>Next week</button></div></div><label>Centre<select value={centreId} onChange={(e) => selectCentre(e.target.value)}><option value="">Choose centre</option>{centres.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}</select></label></div>
      {message && <p role="status">{message}</p>}
      <div className="task-actions" role="group" aria-label="Roster display mode"><button type="button" className={viewMode === "CALENDAR" ? "button button-primary" : "button button-secondary"} aria-pressed={viewMode === "CALENDAR"} onClick={() => setViewMode("CALENDAR")}>Calendar</button><button type="button" className={viewMode === "LIST" ? "button button-primary" : "button button-secondary"} aria-pressed={viewMode === "LIST"} onClick={() => setViewMode("LIST")}>List and edit</button></div>
      <p>Only the entries on the current roster page are shown. Calendar entries are planned shifts or unavailability; they do not confirm attendance, coverage, or work completion.</p>
      {viewMode === "CALENDAR" ? <div className="roster-calendar" aria-label="Weekly staff roster and workload calendar">{calendarDays.map((day) => { const dayWork = dailyWorkload.filter((item) => item.day === day.key); return <section className="roster-calendar-day" key={day.key} aria-labelledby={`roster-day-${day.key}`}><h3 id={`roster-day-${day.key}`}>{day.label}</h3>{day.entries.length ? <ul>{day.entries.map((entry) => { const shift = shifts.find((item) => item.id === entry.id); return <li key={entry.id} className={entry.shiftType === "UNAVAILABLE" ? "roster-calendar-entry is-unavailable" : "roster-calendar-entry"}><strong>{entry.staffName}</strong><span>{entry.shiftType === "UNAVAILABLE" ? "Unavailable" : "Scheduled shift"}</span><time dateTime={entry.startsAt}>{formatDateTimeInZone(entry.startsAt, entry.timeZone)}</time><time dateTime={entry.endsAt}>Until {formatDateTimeInZone(entry.endsAt, entry.timeZone)}</time>{entry.note && <small>{entry.note}</small>}{shift && <button className="text-button" type="button" onClick={() => void viewHistory(shift)}>View history</button>}</li>; })}</ul> : <p>No roster entries on this page.</p>}{dayWork.length > 0 && <div className="roster-day-workload"><h4>Assigned workload</h4><ul>{dayWork.map((item) => { const person = workload.find((member) => member.id === item.staffId); return <li key={`${item.staffId}-${item.day}`}><strong>{person?.name ?? "Assigned staff"}</strong><span>{item.appointments} appointments · {item.collections} collections</span></li>; })}</ul></div>}</section>; })}</div> : shifts.length > 0 ? <div className="table-scroll"><table className="admin-table"><thead><tr><th>Staff</th><th>Type</th><th>Start</th><th>End</th><th>Timezone</th><th>History / actions</th></tr></thead><tbody>{shifts.map((shift) => <tr key={shift.id}><td>{shift.staffName}<small className="appointment-sub">{shift.note || "No note"}</small></td><td>{shift.shiftType === "UNAVAILABLE" ? "Unavailable" : "Scheduled"}</td><td>{formatDateTimeInZone(shift.startsAt, shift.timeZone)}</td><td>{formatDateTimeInZone(shift.endsAt, shift.timeZone)}</td><td>{shift.timeZone}</td><td><button className="text-button" type="button" onClick={() => void viewHistory(shift)}>View history</button>{canManage && <> <button className="text-button" disabled={busy} onClick={() => beginEdit(shift)}>Edit</button> <button className="text-button" disabled={busy} onClick={() => void cancel(shift)}>Cancel</button></>}</td></tr>)}</tbody></table></div> : <p>No roster entries on this page. Switch to Calendar to see the selected week.</p>}
      {historyShift && <section className="admin-card" aria-labelledby="roster-history-heading"><div className="task-toolbar"><div><h3 id="roster-history-heading">Roster history — {historyShift.staffName}</h3><p>Private event details are available only through the authorized roster record.</p></div><button className="button button-secondary" type="button" onClick={() => { setHistoryShift(null); setHistory([]); setHistoryState("idle"); }}>Close history</button></div>{historyState === "loading" ? <p role="status">Loading roster history…</p> : historyState === "error" ? <p role="alert">Roster history is unavailable. Verify centre access and retry.</p> : history.length === 0 ? <p>No history events are available for this roster entry.</p> : <ol className="activity-timeline">{history.map((event) => <li key={event.id}><strong>{event.eventType.replaceAll("_", " ").toLowerCase()}</strong><span>{event.actorName} · {formatDateTimeInZone(event.recordedAt, historyShift.timeZone)}</span>{event.startsAt && event.endsAt && <p>{formatDateTimeInZone(event.startsAt, historyShift.timeZone)} – {formatDateTimeInZone(event.endsAt, historyShift.timeZone)}</p>}{event.reason && <p>Reason: {event.reason}</p>}{event.note && <p>Private note snapshot: {event.note}</p>}</li>)}</ol>}</section>}
      <nav aria-label="Roster entries pages" className="task-pagination"><button type="button" className="button button-secondary" disabled={shiftPage <= 1} onClick={() => setShiftPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {shiftPage}</span><button type="button" className="button button-secondary" disabled={!shiftsHaveMore} onClick={() => setShiftPage((value) => value + 1)}>Next</button></nav>
      <section aria-labelledby="roster-workload-heading"><h3 id="roster-workload-heading">Scheduling and workload counts</h3><p>Counts use the selected week. Scheduled roster time is planned coverage, not attendance or paid hours. Roster coverage warnings are advisory: the system has no approved staffing policy to block an assignment. Patient identities and details are not included.</p>{workloadState === "loading" && <p role="status">Loading staff workload…</p>}{workloadState === "error" && <div role="alert"><p>Staff workload is unavailable. No workload has been assumed.</p><button className="button button-secondary" type="button" onClick={() => setWorkloadRefresh((value) => value + 1)}>Retry workload</button></div>}{workloadState === "ready" && workload.length === 0 && <p role="status">No staff workload is recorded for this week in your authorized scope.</p>}{workloadState === "ready" && workload.length > 0 && <div className="table-scroll"><table className="admin-table"><thead><tr><th>Staff</th><th>Scheduled roster time</th><th>Unavailable periods</th><th>Appointments</th><th>Collections</th><th>Open assigned tasks</th><th>Outside roster (advisory)</th><th>During unavailability (advisory)</th></tr></thead><tbody>{workload.map((row) => <tr key={row.id}><td>{row.name}<small className="appointment-sub">{row.staffCode}</small></td><td>{Math.floor(row.scheduledMinutes / 60)}h {row.scheduledMinutes % 60}m</td><td>{row.unavailablePeriods}</td><td>{row.appointments}</td><td>{row.collections}</td><td>{row.openTasks}</td><td>{row.appointmentsOutsideRoster + row.collectionsOutsideRoster}{row.appointmentsOutsideRoster + row.collectionsOutsideRoster > 0 && <small className="appointment-sub">{row.appointmentsOutsideRoster} appointments · {row.collectionsOutsideRoster} collections</small>}</td><td>{row.assignmentsDuringUnavailability}</td></tr>)}</tbody></table></div>}</section>
      <section aria-labelledby="roster-conflict-heading"><h3 id="roster-conflict-heading">Scheduling conflict review</h3><p>These advisory indicators use current assignments and roster entries. Times are shown in the selected centre timezone. Resolve changes in the authoritative appointment or collection workflow; no staffing eligibility rule is inferred here.</p>{!centreId ? <p>Choose a centre to review scheduling conflicts.</p> : conflicts.length ? <div className="table-scroll"><table className="admin-table"><thead><tr><th>Work item</th><th>Staff</th><th>Time</th><th>Advisory</th><th>Review / resolve</th></tr></thead><tbody>{conflicts.map((conflict) => { const keyId = `${conflict.kind}:${conflict.id}`; const created = escalatedWork.has(keyId) || Boolean(conflict.relatedEscalationId); const mayAssign = canManage && (conflict.kind === "APPOINTMENT" ? canAssignAppointments && Boolean(conflict.expectedUpdatedAt) : canAssignCollections); return <tr key={keyId}><td>{conflict.label}<small className="appointment-sub">{conflict.kind === "APPOINTMENT" ? "Appointment" : "Collection job"}</small></td><td>{conflict.staffName}</td><td>{selectedCentre ? `${formatDateTimeInZone(conflict.startsAt, selectedCentre.timeZone)} – ${formatDateTimeInZone(conflict.endsAt, selectedCentre.timeZone)}` : "Choose a centre"}</td><td>{conflict.advisoryFlags.map((flag) => flag.replaceAll("_", " ").toLowerCase()).join("; ")}</td><td><Link href={conflict.kind === "APPOINTMENT" ? `/appointments/${conflict.id}` : `/collections/${conflict.id}`}>Review assignment</Link>{conflict.relatedEscalationId && <div><Link href={escalationDeepLinkHref(conflict.relatedEscalationId)}>Review open escalation</Link></div>}{mayAssign && <div className="task-inline"><label>Reassign to<select aria-label={`New assignee for ${conflict.label}`} value={reassignStaff[keyId] ?? ""} onChange={(event) => setReassignStaff((current) => ({ ...current, [keyId]: event.target.value }))}><option value="">Choose staff</option>{staff.filter((member) => member.id !== conflict.staffId).map((member) => <option key={member.id} value={member.id}>{member.displayName} ({member.staffCode})</option>)}</select></label><label>Reason<textarea aria-label={`Reason for reassignment of ${conflict.label}`} maxLength={240} value={reassignReason[keyId] ?? ""} onChange={(event) => setReassignReason((current) => ({ ...current, [keyId]: event.target.value }))} /></label><button className="button button-secondary" type="button" disabled={reassigning !== null || !reassignStaff[keyId] || (reassignReason[keyId]?.trim().length ?? 0) < 3} onClick={() => void reassignConflict(conflict)}>{reassigning === keyId ? "Updating…" : "Reassign"}</button></div>}{canEscalate && sessionStaffId && !conflict.relatedEscalationId && <><br /><button className="text-button" type="button" disabled={busy || escalating !== null || created} onClick={() => void escalateConflict(conflict)}>{escalating === keyId ? "Creating…" : created ? "Review escalation created" : "Create review escalation"}</button></>}</td></tr>; })}</tbody></table></div> : <p role="status">{conflictsHaveMore ? "No conflicts on this page. Continue to the next page to review additional assignments." : "No schedule or assignment conflicts found for this week, within your authorized record access."}</p>}</section>
      <nav aria-label="Scheduling conflict pages" className="task-pagination"><button type="button" className="button button-secondary" disabled={conflictPage <= 1} onClick={() => setConflictPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {conflictPage}</span><button type="button" className="button button-secondary" disabled={!conflictsHaveMore} onClick={() => setConflictPage((value) => value + 1)}>Next</button></nav>
    </section>
    <section className="admin-card" aria-labelledby="roster-assignment-history-heading"><h2 id="roster-assignment-history-heading">Assignment change history</h2><p>Read-only history from appointment and collection assignment records. Reassignment reasons remain available only in their authorized record details; this list does not include patient information.</p>{assignmentHistoryMessage ? <p role="status">{assignmentHistoryMessage}</p> : <div className="table-scroll"><table className="admin-table"><thead><tr><th>Work item</th><th>Change</th><th>Previous assignee</th><th>Current assignee</th><th>Recorded by</th><th>Recorded at</th></tr></thead><tbody>{assignmentEvents.map((event) => <tr key={`${event.workType}:${event.id}`}><td>{event.workReference}<small className="appointment-sub">{event.workType === "APPOINTMENT" ? "Appointment" : "Collection job"}</small></td><td>{event.action.replaceAll("_", " ").toLowerCase()}</td><td>{event.previousStaffName ?? "Unassigned"}</td><td>{event.staffName ?? "Unassigned"}</td><td>{event.actorName}</td><td>{selectedCentre ? formatDateTimeInZone(event.recordedAt, selectedCentre.timeZone) : new Date(event.recordedAt).toLocaleString()}</td></tr>)}</tbody></table></div>}<nav aria-label="Assignment history pages" className="task-pagination"><button type="button" className="button button-secondary" disabled={assignmentHistoryPage <= 1} onClick={() => { setAssignmentHistoryMessage("Loading assignment history…"); setAssignmentHistoryPage((value) => Math.max(1, value - 1)); }}>Previous</button><span>Page {assignmentHistoryPage}</span><button type="button" className="button button-secondary" disabled={!assignmentHistoryHasMore} onClick={() => { setAssignmentHistoryMessage("Loading assignment history…"); setAssignmentHistoryPage((value) => value + 1); }}>Next</button></nav></section>
    {editing && <section className="admin-card"><h2>Edit roster entry — {editing.staffName}</h2><form className="admin-form task-form" onSubmit={saveEdit}><label>Starts<input required type="datetime-local" value={editStarts} onChange={(e) => setEditStarts(e.target.value)} /></label><label>Ends<input required type="datetime-local" value={editEnds} onChange={(e) => setEditEnds(e.target.value)} /></label><label>Private note<textarea maxLength={500} value={editNote} onChange={(e) => setEditNote(e.target.value)} /></label><button className="button button-primary" disabled={busy}>Save changes</button><button type="button" className="button button-secondary" onClick={() => setEditing(null)}>Close</button></form></section>}
    {canManage && <section className="admin-card"><h2>Add shift or unavailability</h2><p>Start and end values are entered as local wall times for the selected centre.</p><form className="admin-form task-form" onSubmit={save}>
      <label>Staff member<select required value={staffId} onChange={(e) => setStaffId(e.target.value)}><option value="">Choose staff</option>{staff.map((item) => <option key={item.id} value={item.id}>{item.displayName} ({item.staffCode})</option>)}</select></label>
      <label>Entry type<select value={shiftType} onChange={(e) => setShiftType(e.target.value)}><option value="SCHEDULED">Scheduled shift</option><option value="UNAVAILABLE">Unavailable</option></select></label>
      <label>Starts<input required type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label><label>Ends<input required type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} /></label>
      <label>Centre timezone<input required maxLength={64} value={timeZone} readOnly /></label><label>Private note<textarea maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      <button className="button button-primary" disabled={busy || !centreId || !staffId}>{busy ? "Saving…" : "Save roster entry"}</button>
    </form></section>}
  </>;
}

