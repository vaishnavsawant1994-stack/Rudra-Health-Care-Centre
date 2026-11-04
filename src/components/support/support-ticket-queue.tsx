"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type SupportTicket = {
  id: string;
  centreId: string;
  taskNumber: string;
  title: string;
  description: string;
  priority: string;
  status: string;
  assignedStaffName: string;
  dueAt: string | null;
  createdAt: string;
};

const statuses = ["", "OPEN", "IN_PROGRESS", "AWAITING_APPROVAL", "COMPLETED", "CANCELLED"] as const;

export function SupportTicketQueue({ initialCentreId }: { initialCentreId?: string }) {
  const [rows, setRows] = useState<SupportTicket[]>([]);
  const [status, setStatus] = useState<(typeof statuses)[number]>("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading support requests…");
  const requestSequence = useRef(0);

  const load = useCallback(async (nextPage = 1) => {
    const sequence = ++requestSequence.current;
    setBusy(true);
    setMessage("Loading authorized support requests…");
    try {
      const query = new URLSearchParams({ type: "SUPPORT_REQUEST", page: String(nextPage) });
      if (initialCentreId) query.set("centreId", initialCentreId);
      if (status) query.set("status", status);
      const response = await fetch(`/api/tasks?${query.toString()}`, { cache: "no-store" });
      const data = await response.json() as { tasks?: SupportTicket[]; hasMore?: boolean };
      if (!response.ok) throw new Error("support_queue_unavailable");
      if (sequence !== requestSequence.current) return;
      setRows(data.tasks ?? []);
      setHasMore(data.hasMore === true);
      setPage(nextPage);
      setMessage(data.tasks?.length ? "" : "No support requests match this filter in your authorized centres.");
    } catch {
      if (sequence !== requestSequence.current) return;
      setRows([]);
      setHasMore(false);
      setMessage("Support requests could not be loaded in your authorized scope.");
    } finally {
      if (sequence === requestSequence.current) setBusy(false);
    }
  }, [initialCentreId, status]);

  useEffect(() => { void Promise.resolve().then(() => load(1)); }, [load]);

  return <section className="admin-card" aria-labelledby="support-ticket-queue-title">
    <div className="task-toolbar">
      <div>
        <p className="eyebrow">Support operations</p>
        <h2 id="support-ticket-queue-title">Support requests</h2>
        <p>Requests use the encrypted staff-task record and its existing assignment, escalation, resolution and history rules. This queue does not provide clinical advice or send messages.</p>
      </div>
      <label>Status
        <select value={status} onChange={(event) => { setStatus(event.target.value as (typeof statuses)[number]); setPage(1); }}>
          <option value="">All statuses</option>
          {statuses.filter(Boolean).map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}
        </select>
      </label>
      <button className="button button-secondary" type="button" disabled={busy} onClick={() => void load(1)}>Refresh</button>
    </div>
    {message && <p role="status">{message}</p>}
    {rows.length > 0 && <div className="table-scroll"><table className="admin-table">
      <thead><tr><th>Request</th><th>Priority</th><th>Status</th><th>Assigned to</th><th>Due</th><th>Received</th><th>Record</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id}>
        <td><strong>{row.title}</strong><small className="appointment-sub">{row.taskNumber}</small></td>
        <td>{row.priority}</td><td>{row.status.replaceAll("_", " ")}</td><td>{row.assignedStaffName}</td>
        <td>{row.dueAt ? new Date(row.dueAt).toLocaleString() : "No due time recorded"}</td>
        <td>{new Date(row.createdAt).toLocaleString()}</td>
        <td><Link href={`/support/tickets/${encodeURIComponent(row.id)}?${new URLSearchParams({ centreId: row.centreId })}`}>Open request</Link></td>
      </tr>)}</tbody>
    </table></div>}
    <nav className="task-pagination" aria-label="Support request pages">
      <button className="button button-secondary" type="button" disabled={page <= 1 || busy} onClick={() => void load(page - 1)}>Previous</button>
      <span>Page {page}</span>
      <button className="button button-secondary" type="button" disabled={!hasMore || busy} onClick={() => void load(page + 1)}>Next</button>
    </nav>
    <p className="public-catalogue-note">Support resolution records operational outcomes only. Urgent health concerns must use an appropriate clinical or emergency channel.</p>
  </section>;
}
