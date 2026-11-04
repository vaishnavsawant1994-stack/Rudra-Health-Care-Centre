"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { IdempotencyAttempt } from "@/lib/idempotency-attempt";
import { resolveAuthorizedCentreFilter } from "@/lib/authorized-centre-selection";
import { escalationDeepLinkId } from "@/lib/escalation-deep-link";
import { escalationSourceHref as sourceHref } from "@/lib/escalation-source-link";
import { canManageEscalationInCentre } from "@/lib/escalation-permissions";
import { getEscalationReferenceTypes, type EscalationReferenceType } from "@/lib/escalation-reference-permissions";
import { escalationAssigneesUrl } from "@/lib/escalation-workbench-url";
import { getEscalationTaskHref } from "@/lib/escalation-task-handoff";
import type { PermissionGrant } from "@/server/permissions";

type Centre = { id: string; code: string; name: string };
type RefType = EscalationReferenceType;
type RefOption = { id: string; label: string };
type Escalation = { id: string; centreId: string; escalationNumber: string; assignedOwnerStaffId?: string; source: { type: string; id: string; label: string }; title: string; description: string; severity: string; priority: string; status: string; ownerName: string; dueAt: string; versionNumber: number; overdue: boolean; canManage: boolean };
type History = { id: string; eventType: string; actorName: string; recordedAt: string; reason?: string; comment?: string; assignedOwnerName?: string; sourceLabel?: string; severity?: string; priority?: string; dueAt?: string };
type Assignee = { id: string; displayName: string; staffCode: string };
function localDateTime(value: string) { const date = new Date(value); const offset = date.getTimezoneOffset(); return new Date(date.getTime() - offset * 60_000).toISOString().slice(0, 16); }

export function EscalationWorkbench({ staffId, grants = [], canCreate, canRead = true, initialCentreId }: { staffId: string; grants?: PermissionGrant[]; canCreate: boolean; canRead?: boolean; canAssign?: boolean; initialCentreId?: string }) {
  const mayManage = useCallback((centreId: string) => canManageEscalationInCentre(grants, centreId), [grants]);
  const createAttempt = useRef(new IdempotencyAttempt(`rudra:escalation:create:${staffId}`));
  const actionAttempts = useRef(new Map<string, IdempotencyAttempt>());
  const [items, setItems] = useState<Escalation[]>([]); const [centres, setCentres] = useState<Centre[]>([]); const [readCentres, setReadCentres] = useState<Centre[]>([]); const [filterCentreId, setFilterCentreId] = useState(initialCentreId ?? ""); const [createCentreId, setCreateCentreId] = useState(""); const [status, setStatus] = useState(""); const [filterSeverity, setFilterSeverity] = useState(""); const [filterPriority, setFilterPriority] = useState(""); const [selected, setSelected] = useState<Escalation | null>(null); const [history, setHistory] = useState<History[]>([]); const [historyPage, setHistoryPage] = useState(1); const [historyHasMore, setHistoryHasMore] = useState(false); const [message, setMessage] = useState("Loading escalations…"); const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1); const [hasMore, setHasMore] = useState(false);
  const [sourceType, setSourceType] = useState<RefType>("APPOINTMENT"); const [refs, setRefs] = useState<RefOption[]>([]); const [refsPage, setRefsPage] = useState(1); const [refsHaveMore, setRefsHaveMore] = useState(false); const [sourceId, setSourceId] = useState(""); const [title, setTitle] = useState(""); const [description, setDescription] = useState(""); const [severity, setSeverity] = useState("MODERATE"); const [priority, setPriority] = useState("NORMAL"); const [dueAt, setDueAt] = useState(""); const [comment, setComment] = useState("");
  const referenceTypes = useMemo(() => createCentreId ? getEscalationReferenceTypes(grants, createCentreId) : [], [grants, createCentreId]);
  const selectedReferenceType = referenceTypes.includes(sourceType) ? sourceType : referenceTypes[0];
  const [assignees, setAssignees] = useState<Assignee[]>([]); const [nextOwner, setNextOwner] = useState(""); const [createOwner, setCreateOwner] = useState(staffId);
  const [editSeverity, setEditSeverity] = useState("MODERATE"); const [editPriority, setEditPriority] = useState("NORMAL"); const [editDueAt, setEditDueAt] = useState("");
  const load = useCallback(async () => { setMessage("Loading escalations…"); try { const q = new URLSearchParams(); if (filterCentreId) q.set("centreId", filterCentreId); if (status) q.set("status", status); if (filterSeverity) q.set("severity", filterSeverity); if (filterPriority) q.set("priority", filterPriority); q.set("page", String(page)); const r = await fetch(`/api/escalations?${q}`, { cache: "no-store" }); const b = await r.json(); if (!r.ok) throw Error(b.error); setItems(b.escalations ?? []); setHasMore(b.hasMore ?? false); setMessage(b.escalations?.length ? "" : "No escalations in this view."); } catch { setItems([]); setHasMore(false); setMessage("Escalations are unavailable. Retry when connected."); } }, [filterCentreId, status, filterSeverity, filterPriority, page]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);
  useEffect(() => { if (!canCreate) return; void fetch("/api/escalations/centres?view=create", { cache: "no-store" }).then(r => r.json()).then(b => setCentres(b.centres ?? [])).catch(() => setCentres([])); }, [canCreate]);
  useEffect(() => { if (!canRead) return; let active = true; void fetch("/api/escalations/centres?view=read", { cache: "no-store" }).then(r => r.json()).then(b => { if (!active) return; const authorizedCentres = (b.centres ?? []) as Centre[]; setReadCentres(authorizedCentres); setFilterCentreId(resolveAuthorizedCentreFilter(authorizedCentres, initialCentreId)); }).catch(() => { if (active) { setReadCentres([]); setFilterCentreId(""); } }); return () => { active = false; }; }, [canRead, initialCentreId]);
  useEffect(() => { if (!createCentreId || !selectedReferenceType) return; let active = true; fetch(`/api/tasks/references?centreId=${encodeURIComponent(createCentreId)}&type=${selectedReferenceType}&page=${refsPage}`, { cache: "no-store" }).then(r => r.json()).then(b => { if (!active) return; const next = (b.references ?? []) as RefOption[]; setRefs(current => refsPage === 1 ? next : [...current, ...next.filter(option => !current.some(existing => existing.id === option.id))]); setRefsHaveMore(Boolean(b.hasMore)); if (refsPage === 1) setSourceId(next[0]?.id ?? ""); }).catch(() => { if (active) { setRefs([]); setRefsHaveMore(false); } }); return () => { active = false; }; }, [createCentreId, selectedReferenceType, refsPage]);
  useEffect(() => { if (!createCentreId || !mayManage(createCentreId)) return; let active = true; fetch(escalationAssigneesUrl(createCentreId), { cache: "no-store" }).then(r => r.json()).then(b => { if (!active) return; setAssignees(b.staff ?? []); }).catch(() => { if (active) setAssignees([]); }); return () => { active = false; }; }, [mayManage, createCentreId]);
  useEffect(() => { if (!selected || !selected.canManage) return; let active = true; fetch(escalationAssigneesUrl(selected.centreId), { cache: "no-store" }).then(r => r.json()).then(b => { if (!active) return; setAssignees(b.staff ?? []); setNextOwner(selected.assignedOwnerStaffId ?? ""); }).catch(() => { if (active) setAssignees([]); }); return () => { active = false; }; }, [selected]);
  async function create(event: React.FormEvent) {
    event.preventDefault();
    if (!createCentreId || !selectedReferenceType || !sourceId || !dueAt) { setMessage("Choose a centre, permitted related record and due time."); return; }
    setBusy(true);
    const attempt = createAttempt.current;
    try {
      const body = JSON.stringify({ centreId: createCentreId, source: { type: selectedReferenceType, id: sourceId }, title, description, severity, priority, assignedOwnerStaffId: mayManage(createCentreId) ? createOwner : staffId, dueAt: new Date(dueAt).toISOString(), deduplicateOpenSource: true });
      const key = await attempt.keyFor(body);
      const response = await fetch("/api/escalations", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body });
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500) attempt.clear();
        setMessage(response.status >= 500 ? "Escalation save could not be confirmed. Retry the unchanged form to safely check whether it saved." : result.error ?? "Escalation could not be created.");
        return;
      }
      attempt.clear();
      setTitle(""); setDescription(""); setMessage(result.escalation?.alreadyOpen ? "An open escalation already exists for this record; no duplicate was created." : "Escalation created."); await load();
    } catch { setMessage("Escalation save could not be confirmed. Retry the unchanged form to safely check whether it saved."); }
    finally { setBusy(false); }
  }
  const open = useCallback(async (id: string, selectedHistoryPage = 1) => { try { const r = await fetch(`/api/escalations/${id}?historyPage=${selectedHistoryPage}`, { cache: "no-store" }); const b = await r.json(); if (!r.ok) { setSelected(null); setMessage(b.error ?? "Escalation unavailable."); return; } setSelected(b.escalation); setHistory(b.history ?? []); setHistoryPage(b.historyPage ?? selectedHistoryPage); setHistoryHasMore(b.historyHasMore ?? false); setEditSeverity(b.escalation.severity); setEditPriority(b.escalation.priority); setEditDueAt(localDateTime(b.escalation.dueAt)); } catch { setSelected(null); setMessage("Escalation details are unavailable. Retry when connected."); } }, []);
  useEffect(() => {
    const id = escalationDeepLinkId(window.location.search);
    if (!id) return;
    const timer = window.setTimeout(() => { void open(id); }, 0);
    return () => window.clearTimeout(timer);
  }, [open]);
  async function act(action: string, extra: Record<string, unknown> = {}) { if (!selected) return; setBusy(true); const body = JSON.stringify({ action, expectedVersion: selected.versionNumber, ...extra }); const attemptKey = `${selected.id}:${action}`; const attempt = actionAttempts.current.get(attemptKey) ?? new IdempotencyAttempt(`rudra:escalation:${staffId}:${attemptKey}`); actionAttempts.current.set(attemptKey, attempt); try { const idempotencyKey = await attempt.keyFor(body); const r = await fetch(`/api/escalations/${selected.id}`, { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body }); const b = await r.json(); if (!r.ok) { if (r.status < 500) { attempt.clear(); actionAttempts.current.delete(attemptKey); } throw Error(b.error); } attempt.clear(); actionAttempts.current.delete(attemptKey); setComment(""); setMessage(b.escalation?.replayed ? "The prior escalation action was already saved." : "Escalation updated."); await open(selected.id); await load(); } catch (e) { const code = e instanceof Error ? e.message : ""; setMessage(code === "due_date_must_be_future" ? "Choose a future due time." : code === "version_conflict" ? "This escalation changed elsewhere. Refresh its details before updating." : code === "idempotency_conflict" ? "This action key was already used for a different request. Refresh the escalation before retrying." : "Escalation update could not be confirmed. Retry the unchanged action to safely check whether it saved."); } finally { setBusy(false); } }
  function saveEscalationUpdate() {
    const update: { severity: string; priority: string; dueAt?: string; reason: string } = { severity: editSeverity, priority: editPriority, reason: comment };
    if (editDueAt.trim()) {
      const parsed = new Date(editDueAt);
      if (Number.isNaN(parsed.getTime())) { setMessage("Enter a valid due time or clear the field to leave it unchanged."); return; }
      update.dueAt = parsed.toISOString();
    }
    void act("UPDATE", update);
  }
  const selectedTaskHref = selected ? getEscalationTaskHref({ centreId: selected.centreId, escalationId: selected.id, grants }) : null;
  return <div className="workspace-operations">
    <div className="admin-card"><label>Centre <select value={filterCentreId} onChange={e => { setFilterCentreId(e.target.value); setPage(1); }}><option value="">All permitted centres</option>{readCentres.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label> <label>Status <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">Active and resolved</option><option>OPEN</option><option>ACKNOWLEDGED</option><option>OVERDUE</option><option>RESOLVED</option><option>CANCELLED</option></select></label> <label>Severity <select value={filterSeverity} onChange={e => { setFilterSeverity(e.target.value); setPage(1); }}><option value="">All severities</option>{["LOW", "MODERATE", "HIGH", "URGENT"].map(value => <option key={value}>{value}</option>)}</select></label> <label>Priority <select value={filterPriority} onChange={e => { setFilterPriority(e.target.value); setPage(1); }}><option value="">All priorities</option>{["LOW", "NORMAL", "HIGH", "URGENT"].map(value => <option key={value}>{value}</option>)}</select></label> <button type="button" onClick={() => void load()}>Refresh</button></div>
    {canCreate && (
      <form className="admin-card" onSubmit={create}>
        <h2>Raise an escalation</h2>
        <div className="form-grid">
          <label>Centre
            <select required value={createCentreId} onChange={e => { setCreateCentreId(e.target.value); setCreateOwner(staffId); setAssignees([]); setRefsPage(1); setRefs([]); setSourceId(""); }}>
              <option value="">Select centre</option>{centres.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {createCentreId && mayManage(createCentreId) && <label>Assign owner
            <select required value={createOwner} onChange={e => setCreateOwner(e.target.value)}>
              <option value={staffId}>Myself</option>{assignees.filter(person => person.id !== staffId).map(person => <option key={person.id} value={person.id}>{person.displayName} ({person.staffCode})</option>)}
            </select>
          </label>}
          {!createCentreId ? <p>Select a centre to see related records available under your permissions.</p> : referenceTypes.length === 0 ? <p role="status">You do not have permission to link an escalation to a readable record in this centre.</p> : <>
            <label>Related record
              <select value={selectedReferenceType} onChange={e => { setSourceType(e.target.value as RefType); setRefsPage(1); setRefs([]); setSourceId(""); }}>
                {referenceTypes.map(t => <option key={t} value={t}>{t.replaceAll("_", " ")}</option>)}
              </select>
            </label>
            <label>Record
              <select required value={sourceId} onChange={e => setSourceId(e.target.value)}>
                <option value="">Select record</option>{refs.map(x => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
              {refsHaveMore && <button type="button" className="text-button" onClick={() => setRefsPage(value => value + 1)}>Load more related records</button>}
            </label>
            <label>Severity<select value={severity} onChange={e => setSeverity(e.target.value)}>{["LOW", "MODERATE", "HIGH", "URGENT"].map(x => <option key={x}>{x}</option>)}</select></label>
            <label>Priority<select value={priority} onChange={e => setPriority(e.target.value)}>{["LOW", "NORMAL", "HIGH", "URGENT"].map(x => <option key={x}>{x}</option>)}</select></label>
            <label>Due at<input type="datetime-local" required value={dueAt} onChange={e => setDueAt(e.target.value)} /></label>
            <label>Title<input required minLength={3} maxLength={120} value={title} onChange={e => setTitle(e.target.value)} /></label>
            <label>Description<textarea maxLength={2000} value={description} onChange={e => setDescription(e.target.value)} /></label>
          </>}
        </div>
        <button disabled={busy || !centres.length || !referenceTypes.length}>Create escalation</button>
      </form>
    )}
    {message && <p role="status">{message}</p>}
    <div className="workspace-grid">{items.map(item => <article className="admin-card" key={item.id}><p className="eyebrow">{item.escalationNumber} · {item.severity}{item.overdue ? " · OVERDUE" : ""}</p><h2>{item.title}</h2><p>{sourceHref(item.source.type,item.source.id,item.centreId) ? <Link href={sourceHref(item.source.type,item.source.id,item.centreId)!}>{item.source.label}</Link> : item.source.label}</p><p>{item.status} · Assigned to {item.ownerName}</p><p>Due {new Date(item.dueAt).toLocaleString()}</p><button type="button" onClick={() => void open(item.id)}>Details and history</button></article>)}</div>
    <nav aria-label="Escalation queue pages" className="task-pagination"><button type="button" className="button button-secondary" disabled={page <= 1} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</button><span>Page {page}</span><button type="button" className="button button-secondary" disabled={!hasMore} onClick={() => setPage(value => value + 1)}>Next</button></nav>
    {selected && <section className="admin-card" aria-label="Escalation details"><button type="button" onClick={() => setSelected(null)}>Close</button><h2>{selected.title}</h2>{selectedTaskHref && <Link className="button-link" href={selectedTaskHref}>Create follow-up task</Link>}<p>{selected.description || "No additional details."}</p><p>{sourceHref(selected.source.type,selected.source.id,selected.centreId) ? <Link href={sourceHref(selected.source.type,selected.source.id,selected.centreId)!}>{selected.source.label}</Link> : selected.source.label} · {selected.status} · {selected.priority}</p><div className="button-row">{selected.status === "OPEN" && <button disabled={busy} onClick={() => void act("ACKNOWLEDGE")}>Acknowledge</button>}{["OPEN", "ACKNOWLEDGED"].includes(selected.status) && <button disabled={busy || !comment.trim()} onClick={() => void act("RESOLVE", { reason: comment })}>Resolve</button>}{selected.canManage && selected.status === "RESOLVED" && <><label>New due time<input aria-label="New due time for reopened escalation" type="datetime-local" min={localDateTime(new Date().toISOString())} value={editDueAt} onChange={e => setEditDueAt(e.target.value)} /></label><button disabled={busy || !comment.trim() || !editDueAt || !Number.isFinite(new Date(editDueAt).getTime())} onClick={() => { if (new Date(editDueAt).getTime() <= Date.now()) { setMessage("Choose a future due time."); return; } void act("REOPEN", { reason: comment, dueAt: new Date(editDueAt).toISOString() }); }}>Reopen</button></>}{selected.canManage && ["OPEN", "ACKNOWLEDGED"].includes(selected.status) && <><button disabled={busy || !comment.trim()} onClick={() => void act("CANCEL", { reason: comment })}>Cancel</button><label>Reassign to<select value={nextOwner} onChange={e => setNextOwner(e.target.value)}><option value="">Select staff</option>{assignees.map(person => <option key={person.id} value={person.id}>{person.displayName} · {person.staffCode}</option>)}</select></label><button disabled={busy || !nextOwner || !comment.trim()} onClick={() => void act("REASSIGN", { assignedOwnerStaffId: nextOwner, reason: comment })}>Reassign</button></>}</div><label>Comment / required action reason<textarea value={comment} onChange={e => setComment(e.target.value)} maxLength={1000} /></label><button disabled={busy || !comment.trim()} onClick={() => void act("COMMENT", { comment })}>Add comment</button>{selected.canManage && ["OPEN", "ACKNOWLEDGED"].includes(selected.status) && <fieldset><legend>Update escalation</legend><div className="form-grid"><label>Severity<select value={editSeverity} onChange={e => setEditSeverity(e.target.value)}>{["LOW", "MODERATE", "HIGH", "URGENT"].map(value => <option key={value}>{value}</option>)}</select></label><label>Priority<select value={editPriority} onChange={e => setEditPriority(e.target.value)}>{["LOW", "NORMAL", "HIGH", "URGENT"].map(value => <option key={value}>{value}</option>)}</select></label><label>Due time<input type="datetime-local" min={localDateTime(new Date().toISOString())} value={editDueAt} onChange={e => setEditDueAt(e.target.value)} /></label></div><button disabled={busy || !comment.trim()} onClick={saveEscalationUpdate}>Save escalation updates</button></fieldset>}<h3>History</h3><ol>{history.map(h => <li key={h.id}>{h.eventType} · {h.actorName} · {new Date(h.recordedAt).toLocaleString()} {h.comment || h.reason || ""}{h.assignedOwnerName ? ` · assigned to ${h.assignedOwnerName}` : ""}</li>)}</ol><nav aria-label="Escalation event history pages" className="task-pagination"><button type="button" className="button button-secondary" disabled={historyPage <= 1 || busy} onClick={() => void open(selected.id, Math.max(1, historyPage - 1))}>Newer events</button><span>Page {historyPage}</span><button type="button" className="button button-secondary" disabled={!historyHasMore || busy} onClick={() => void open(selected.id, historyPage + 1)}>Older events</button></nav></section>}
  </div>;
}
