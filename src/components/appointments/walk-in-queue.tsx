"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { PermissionGrant } from "@/server/permissions";
import { mayManageWalkInQueueAtCentre } from "@/lib/walk-in-queue-permissions";

type Centre = { id: string; name: string; code: string };
type WalkIn = { id: string; appointmentNumber: string; scheduledAt: string; patientNumber: string; patientName: string; tokenId: string | null; tokenNumber: number | null; queueStatus: "WAITING" | "CALLED" | null; versionNumber: number | null; issuedAt: string | null; calledAt: string | null; actorStaffId: string; arrivedAt: string };
type QueueResponse = { queueDate?: string; timeZone?: string; walkIns?: WalkIn[]; pendingTokens?: number; page?: number; hasMore?: boolean; error?: string };

export function WalkInQueue({ grants = [] }: { grants?: readonly PermissionGrant[] }) {
  const [centres, setCentres] = useState<Centre[]>([]);
  const [centreId, setCentreId] = useState("");
  const [walkIns, setWalkIns] = useState<WalkIn[]>([]);
  const [queueDate, setQueueDate] = useState("");
  const [timeZone, setTimeZone] = useState("");
  const [pendingTokens, setPendingTokens] = useState(0);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [message, setMessage] = useState("Loading walk-in queue…");
  const [busy, setBusy] = useState(false);
  const issueKeys = useRef(new Map<string, string>());
  const callNextKey = useRef<string | null>(null);
  const canManage = Boolean(centreId && mayManageWalkInQueueAtCentre(grants, centreId));

  useEffect(() => {
    let active = true;
    void fetch("/api/appointments/centres", { cache: "no-store" }).then(async response => ({ response, body: await response.json() as { centres?: Centre[] } })).then(({ response, body }) => {
      if (!active) return;
      const available = response.ok ? body.centres ?? [] : [];
      setCentres(available);
      setCentreId(available[0]?.id ?? "");
      setMessage(response.ok ? available.length ? "" : "No authorized centre is available." : "Walk-in queue access is unavailable.");
    }).catch(() => { if (active) setMessage("Walk-in queue service is unavailable."); });
    return () => { active = false; };
  }, []);

  const applyQueue = useCallback((body: QueueResponse) => {
      setWalkIns(body.walkIns ?? []);
      setQueueDate(body.queueDate ?? "");
      setTimeZone(body.timeZone ?? "");
      setPendingTokens(body.pendingTokens ?? 0);
      setHasMore(body.hasMore ?? false);
      setMessage(body.walkIns?.length ? "" : "No arrived, confirmed walk-ins are in the queue today.");
  }, []);

  const load = useCallback(async () => {
    if (!centreId) return;
    try {
      const response = await fetch(`/api/appointments/queue?centreId=${encodeURIComponent(centreId)}&page=${page}&pageSize=50`, { cache: "no-store" });
      const body = await response.json() as QueueResponse;
      if (!response.ok) throw new Error(body.error ?? "Queue unavailable");
      applyQueue(body);
    } catch { setWalkIns([]); setPendingTokens(0); setMessage("Walk-in queue could not be loaded. Check centre access and retry."); }
  }, [applyQueue, centreId, page]);

  useEffect(() => {
    if (!centreId) return;
    let active = true;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/appointments/queue?centreId=${encodeURIComponent(centreId)}&page=${page}&pageSize=50`, { cache: "no-store" });
        const body = await response.json() as QueueResponse;
        if (!response.ok) throw new Error(body.error ?? "Queue unavailable");
        if (active) applyQueue(body);
      } catch { if (active) { setWalkIns([]); setPendingTokens(0); setMessage("Walk-in queue could not be loaded. Check centre access and retry."); } }
    };
    void refresh();
    return () => { active = false; };
  }, [applyQueue, centreId, page]);

  async function act(payload: { action: "ISSUE"; centreId: string; appointmentId: string } | { action: "CALL_NEXT"; centreId: string }, key: string) {
    setBusy(true);
    try {
      const response = await fetch("/api/appointments/queue", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(payload) });
      const body = await response.json() as { error?: string; token?: { tokenNumber: number; status: string; replayed: boolean } };
      if (!response.ok) throw new Error(body.error ?? "queue_action_failed");
      if (payload.action === "ISSUE") issueKeys.current.delete(payload.appointmentId);
      else callNextKey.current = null;
      await load();
      setMessage(body.token?.replayed ? `Request already completed. Token ${body.token.tokenNumber} is ${body.token.status.toLowerCase()}.` : payload.action === "ISSUE" ? `Walk-in token ${body.token?.tokenNumber} issued.` : `Token ${body.token?.tokenNumber} called.`);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "queue_empty") callNextKey.current = null;
      setMessage(code === "walk_in_arrival_required" ? "Record today’s centre arrival before issuing a queue token." : code === "walk_in_not_queue_eligible" ? "Only confirmed centre walk-ins can receive a token." : code === "queue_token_exists" ? "This walk-in already has a queue token. Refresh the queue." : "Queue action was not confirmed. Retry safely or refresh the queue.");
    } finally { setBusy(false); }
  }

  return <section className="admin-card">
    <div className="appointment-toolbar"><div><p className="eyebrow">Reception</p><h2>Walk-in tokens and calling queue</h2><p>Only confirmed centre walk-ins with a recorded arrival can receive a token. Calling a token does not mark a service complete.</p></div><label>Centre<select value={centreId} onChange={event => { setPage(1); setCentreId(event.target.value); }}>{centres.map(centre => <option key={centre.id} value={centre.id}>{centre.name} ({centre.code})</option>)}</select></label></div>
    {queueDate && <p>Queue date: {queueDate} · {timeZone}</p>}
    {canManage && <div className="task-actions"><button type="button" className="button button-primary" disabled={busy || pendingTokens === 0 || !centreId} onClick={() => { callNextKey.current ??= crypto.randomUUID(); void act({ action: "CALL_NEXT", centreId }, callNextKey.current); }}>{busy ? "Updating queue…" : `Call next${pendingTokens ? ` · ${pendingTokens} waiting` : ""}`}</button><button type="button" className="button button-secondary" disabled={busy || !centreId} onClick={() => void load()}>Refresh queue</button></div>}
    {message && <p role="status">{message}</p>}
    {walkIns.length > 0 && <><div className="table-scroll"><table className="admin-table"><thead><tr><th>Token</th><th>Patient</th><th>Arrival</th><th>Appointment</th><th>Queue state</th>{canManage && <th>Action</th>}</tr></thead><tbody>{walkIns.map(item => <tr key={item.id}><td>{item.tokenNumber ? `#${item.tokenNumber}` : "Not issued"}</td><td>{item.patientName}<small className="appointment-sub">{item.patientNumber}</small></td><td>{new Date(item.arrivedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", timeZone })}</td><td><Link href={`/appointments/${item.id}`}>{item.appointmentNumber}</Link></td><td>{item.queueStatus ?? "ARRIVED"}</td>{canManage && <td>{!item.tokenId && <button type="button" className="text-button" disabled={busy} onClick={() => { const key = issueKeys.current.get(item.id) ?? crypto.randomUUID(); issueKeys.current.set(item.id, key); void act({ action: "ISSUE", centreId, appointmentId: item.id }, key); }}>Issue token</button>}</td>}</tr>)}</tbody></table></div><div className="task-actions"><button type="button" className="button button-secondary" disabled={page <= 1 || busy} onClick={() => setPage(value => Math.max(1, value - 1))}>Previous</button><span>Page {page}</span><button type="button" className="button button-secondary" disabled={!hasMore || busy} onClick={() => setPage(value => value + 1)}>Next</button></div></>}
  </section>;
}
