"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type AuditEvent = { sequence: number; centreId: string | null; action: string; entityType: string; entityId: string | null; details: Record<string, unknown>; recordedAt: string };
type AuditResult = { events?: AuditEvent[]; hasMore?: boolean; error?: string };

export function AuditWorkbench() {
  const [action, setAction] = useState("");
  const [entityType, setEntityType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [page, setPage] = useState(1);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [message, setMessage] = useState("Loading authorized audit events…");
  const [appliedFilters, setAppliedFilters] = useState({ action: "", entityType: "", from: "", to: "" });
  const latestRequest = useRef(0);

  const load = useCallback(async (filters: { action: string; entityType: string; from: string; to: string; page: number }) => {
    const requestId = ++latestRequest.current;
    const params = new URLSearchParams({ page: String(filters.page) });
    if (filters.action.trim()) params.set("action", filters.action.trim());
    if (filters.entityType.trim()) params.set("entityType", filters.entityType.trim());
    if (filters.from) params.set("from", filters.from);
    if (filters.to) params.set("to", filters.to);
    setMessage("Loading authorized audit events…");
    try {
      const response = await fetch(`/api/admin/audit?${params}`, { cache: "no-store" });
      const result = await response.json() as AuditResult;
      if (requestId !== latestRequest.current) return;
      if (!response.ok) throw new Error(result.error ?? "audit_unavailable");
      setEvents(result.events ?? []);
      setHasMore(Boolean(result.hasMore));
      setMessage(result.events?.length ? "" : "No audit events match these filters in your authorized scope.");
    } catch {
      if (requestId !== latestRequest.current) return;
      setEvents([]);
      setHasMore(false);
      setMessage("Audit events could not be loaded. Verify your access or retry.");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load({ ...appliedFilters, page }), 0);
    return () => { window.clearTimeout(timer); latestRequest.current += 1; };
  }, [appliedFilters, page, load]);

  function applyFilters(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (from && to && from > to) {
      setMessage("The start date must be on or before the end date.");
      return;
    }
    setPage(1);
    setAppliedFilters({ action: action.trim(), entityType: entityType.trim(), from, to });
  }

  return <section className="admin-card" aria-labelledby="audit-events-heading">
    <div className="task-toolbar"><div><h2 id="audit-events-heading">Authorized audit events</h2><p>Results are limited to your audit permission scope. Event details are hidden until opened; exports are not provided by this screen.</p></div><button className="button button-secondary" type="button" onClick={() => void load({ ...appliedFilters, page })}>Refresh</button></div>
    <form className="admin-form" onSubmit={applyFilters} aria-label="Audit event filters">
      <label>Action<input maxLength={120} value={action} onChange={(event) => setAction(event.target.value)} /></label>
      <label>Record type<input maxLength={80} value={entityType} onChange={(event) => setEntityType(event.target.value)} /></label>
      <label>From date<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Through date<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button className="button button-primary" type="submit">Apply filters</button>
    </form>
    {message && <div>{message.includes("could not be loaded") ? <p role="alert">{message}</p> : <p role="status">{message}</p>}{message.includes("could not be loaded") && <button className="button button-secondary" type="button" onClick={() => void load({ ...appliedFilters, page })}>Retry</button>}</div>}
    {events.length > 0 && <div className="table-scroll"><table className="admin-table"><thead><tr><th>Sequence</th><th>Centre</th><th>Action</th><th>Record</th><th>Recorded at</th><th>Details</th></tr></thead><tbody>{events.map((item) => <tr key={item.sequence}><td>{item.sequence}</td><td>{item.centreId ?? "Organization"}</td><td>{item.action}</td><td>{item.entityType}{item.entityId ? ` · ${item.entityId}` : ""}</td><td><time dateTime={item.recordedAt}>{new Date(item.recordedAt).toLocaleString()}</time></td><td><details><summary>View event details</summary><pre className="data-output">{JSON.stringify(item.details, null, 2)}</pre></details></td></tr>)}</tbody></table></div>}
    <nav className="task-pagination" aria-label="Audit event pages"><button className="button button-secondary" type="button" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Previous</button><span>Page {page}</span><button className="button button-secondary" type="button" disabled={!hasMore} onClick={() => setPage((value) => value + 1)}>Next</button></nav>
  </section>;
}
