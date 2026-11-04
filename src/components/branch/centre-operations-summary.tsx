"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { formatCentreQueueTime } from "@/lib/centre-queue-time";
import { loadCentreOperationsSummary, type CentreOperationsSummary as CentreSummary } from "./centre-operations-client";

const centreHref = (path: string, centreId: string, filters: Record<string, string> = {}) => `${path}?${new URLSearchParams({ centreId, ...filters })}`;

export function CentreOperationsSummary() {
  const [centres, setCentres] = useState<CentreSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshedAt, setRefreshedAt] = useState<Date | null>(null);
  const request = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError(false);
    try {
      const data = await loadCentreOperationsSummary(controller.signal);
      if (!controller.signal.aborted) { setCentres(data); setRefreshedAt(new Date()); }
    } catch (reason: unknown) {
      if (!(reason instanceof DOMException && reason.name === "AbortError") && !controller.signal.aborted) setError(true);
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const timer = window.setTimeout(() => { void refresh(); }, 0);
    return () => { window.clearTimeout(timer); request.current?.abort(); };
  }, [refresh]);

  if (error && centres === null) return <section className="admin-card" role="alert"><h2>Operations summary unavailable</h2><p>The scoped summary could not be loaded.</p><button type="button" className="button button-secondary" onClick={() => void refresh()}>Retry</button></section>;
  if (centres === null) return <section className="admin-card" role="status"><p>Loading centre summaries…</p></section>;
  if (!centres.length) return <section className="admin-card"><h2>No centre operations access</h2><p>Ask an Owner to review your centre assignments and operational permissions.</p><button type="button" className="button button-secondary" disabled={loading} onClick={() => void refresh()}>{loading ? "Refreshing…" : "Refresh"}</button></section>;

  return <div className="centre-operations-list">
    <div className="task-toolbar"><p className="admin-muted">Counts only. Patient names and private appointment, financial, sample or report details are not included.</p><div><button type="button" className="button button-secondary" disabled={loading} onClick={() => void refresh()}>{loading ? "Refreshing…" : "Refresh queues"}</button>{refreshedAt && <p className="admin-muted" aria-live="polite">Last updated {refreshedAt.toLocaleTimeString()}</p>}</div></div>
    {error && <p role="alert">Refresh failed. Showing the last successfully loaded summary.</p>}
    {centres.map((centre) => <section className="admin-card centre-operations-card" key={centre.id}>
      <div><p className="eyebrow">{centre.code} · {centre.timeZone}</p><h2>{centre.name}</h2></div>
      <dl className="centre-operations-metrics">
        {centre.metrics.appointmentsNext24Hours !== undefined && <div><dt>Appointments · next 24 hours</dt><dd>{centre.metrics.appointmentsNext24Hours}</dd></div>}
        {centre.metrics.appointmentsWithoutArrivalToday !== undefined && <div><dt>Confirmed centre visits without recorded arrival today</dt><dd>{centre.metrics.appointmentsWithoutArrivalToday}</dd></div>}
        {centre.metrics.pendingConfirmations !== undefined && <div><dt>Pending confirmations</dt><dd>{centre.metrics.pendingConfirmations}</dd></div>}
        {centre.metrics.pendingWebsiteEnquiries !== undefined && <div><dt>Website enquiries pending review</dt><dd>{centre.metrics.pendingWebsiteEnquiries}</dd></div>}
        {centre.metrics.openOrders !== undefined && <div><dt>Orders awaiting confirmation</dt><dd>{centre.metrics.openOrders}</dd></div>}
        {centre.metrics.activeCollections !== undefined && <div><dt>Open collection jobs</dt><dd>{centre.metrics.activeCollections}</dd></div>}
        {centre.metrics.pendingReceiving !== undefined && <div><dt>Samples awaiting Rudra receiving</dt><dd>{centre.metrics.pendingReceiving}</dd></div>}
        {centre.metrics.pendingDispatch !== undefined && <div><dt>Samples awaiting dispatch</dt><dd>{centre.metrics.pendingDispatch}</dd></div>}
        {centre.metrics.openExceptions !== undefined && <div><dt>Open sample exceptions</dt><dd>{centre.metrics.openExceptions}</dd></div>}
        {centre.metrics.overdueLeadFollowups !== undefined && <div><dt>Overdue lead follow-ups</dt><dd>{centre.metrics.overdueLeadFollowups}</dd></div>}
        {centre.metrics.overdueReportFollowups !== undefined && <div><dt>Overdue report follow-ups</dt><dd>{centre.metrics.overdueReportFollowups}</dd></div>}
        {centre.metrics.openTasks !== undefined && <div><dt>Open staff tasks</dt><dd>{centre.metrics.openTasks}</dd></div>}
        {centre.metrics.openSupportRequests !== undefined && <div><dt>Open support requests</dt><dd>{centre.metrics.openSupportRequests}</dd></div>}
        {centre.metrics.pendingTaskApprovals !== undefined && <div><dt>Task approvals pending</dt><dd>{centre.metrics.pendingTaskApprovals}</dd></div>}
        {centre.metrics.taskApprovalExpiryDue !== undefined && <div><dt>Task approvals past expiry</dt><dd>{centre.metrics.taskApprovalExpiryDue}</dd></div>}
        {centre.metrics.taskApprovalEscalationDue !== undefined && <div><dt>Task approval escalations due</dt><dd>{centre.metrics.taskApprovalEscalationDue}</dd></div>}
        {centre.metrics.overdueTasks !== undefined && <div><dt>Overdue staff tasks</dt><dd>{centre.metrics.overdueTasks}</dd></div>}
        {centre.metrics.openEscalations !== undefined && <div><dt>Open escalations</dt><dd>{centre.metrics.openEscalations}</dd></div>}
        {centre.metrics.overdueEscalations !== undefined && <div><dt>Overdue escalations</dt><dd>{centre.metrics.overdueEscalations}</dd></div>}
        {centre.metrics.financePendingPayments !== undefined && <div><dt>Payments awaiting review</dt><dd>{centre.metrics.financePendingPayments}</dd></div>}
        {centre.metrics.financeDisputes !== undefined && <div><dt>Disputed payments</dt><dd>{centre.metrics.financeDisputes}</dd></div>}
        {centre.metrics.financeRefundRequests !== undefined && <div><dt>Refund requests awaiting review</dt><dd>{centre.metrics.financeRefundRequests}</dd></div>}
        {centre.metrics.scheduledStaff !== undefined && <div><dt>Staff shifts starting in 24 hours</dt><dd>{centre.metrics.scheduledStaff}</dd></div>}
        {centre.metrics.staffUnavailable !== undefined && <div><dt>Unavailability entries starting in 24 hours</dt><dd>{centre.metrics.staffUnavailable}</dd></div>}
      </dl>
      <section aria-label={`${centre.name} combined operational queue`}><h3>Combined operational queue preview</h3><p className="admin-muted">Showing up to 10 items per queue and 50 overall. Only records covered by your active grants are included. Patient names, addresses and private notes are omitted; each destination rechecks access.</p>{Object.keys(centre.omittedByKind ?? {}).length > 0 && <p className="admin-muted" role="status">Additional work is not shown in this preview: {Object.entries(centre.omittedByKind ?? {}).map(([kind, count]) => `${kind.replaceAll("_", " ").toLowerCase()} (${count})`).join(", ")}. Use the full work-queue links below.</p>}{centre.queue.length ? <ul className="centre-operations-queue">{centre.queue.map((item) => <li key={`${item.kind}:${item.id}`}><span><strong>{item.title}</strong><small>{item.reference} · {item.status.replaceAll("_", " ").toLowerCase()} · <time dateTime={item.at}>{formatCentreQueueTime(item.at, centre.timeZone)}</time></small></span><Link href={item.href}>Open</Link></li>)}</ul> : <p>No open work items in the queues visible to this session.</p>}</section>
      <nav className="centre-operations-actions" aria-label={`${centre.name} work queues`}>
        {centre.metrics.pendingConfirmations !== undefined && <Link href={centreHref("/appointments", centre.id)}>Open appointments</Link>}
        {centre.metrics.pendingConfirmations !== undefined && <Link href={centreHref("/appointments", centre.id, { status: "REQUESTED" })}>Review pending confirmations</Link>}
        {centre.metrics.pendingWebsiteEnquiries !== undefined && <Link href={centreHref("/leads/public-enquiries", centre.id)}>Review website enquiries</Link>}
        {centre.metrics.appointmentsWithoutArrivalToday !== undefined && <Link href={centreHref("/appointments/arrivals", centre.id)}>Open arrival queue</Link>}
        {centre.metrics.openOrders !== undefined && <Link href={centreHref("/orders", centre.id)}>Open orders</Link>}
        {centre.metrics.activeCollections !== undefined && <Link href={centreHref("/collections", centre.id)}>Open collections</Link>}
        {centre.metrics.pendingReceiving !== undefined && <Link href={centreHref("/branch/receiving", centre.id)}>Open receiving queue</Link>}
        {centre.metrics.pendingDispatch !== undefined && <Link href={centreHref("/branch/dispatch", centre.id)}>Open dispatch queue</Link>}
        {centre.metrics.openExceptions !== undefined && <Link href={centreHref("/samples/exceptions", centre.id)}>Review exceptions</Link>}
        {centre.metrics.overdueLeadFollowups !== undefined && <Link href={centreHref("/leads/followups", centre.id)}>Open lead follow-ups</Link>}
        {centre.metrics.overdueReportFollowups !== undefined && <Link href={centreHref("/reports/followups", centre.id)}>Open report follow-ups</Link>}
        {centre.metrics.openTasks !== undefined && <Link href={centreHref("/tasks", centre.id)}>Open staff tasks</Link>}
        {centre.metrics.openSupportRequests !== undefined && <Link href={centreHref("/support/tickets", centre.id)}>Open support requests</Link>}
        {centre.metrics.taskApprovalExpiryDue !== undefined && <Link href={centreHref("/tasks/approvals", centre.id, { queue: "expiry-due" })}>Review expired approvals</Link>}
        {centre.metrics.taskApprovalEscalationDue !== undefined && <Link href={centreHref("/tasks/approvals", centre.id, { queue: "escalation-due" })}>Review task approval escalations</Link>}
        {centre.metrics.openEscalations !== undefined && <Link href={centreHref("/escalations", centre.id)}>Open escalation queue</Link>}
        {centre.metrics.financePendingPayments !== undefined && <Link href={centreHref("/finance", centre.id)}>Open accounts workbench</Link>}
        {centre.metrics.scheduledStaff !== undefined && <Link href={centreHref("/roster", centre.id)}>Open staff roster</Link>}
      </nav>
    </section>)}
  </div>;
}
