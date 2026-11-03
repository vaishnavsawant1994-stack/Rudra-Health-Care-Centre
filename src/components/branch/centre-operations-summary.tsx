"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { formatCentreQueueTime } from "@/lib/centre-queue-time";

type QueueItem = { id: string; kind: string; title: string; reference: string; status: string; at: string; href: string };
type CentreSummary = { id: string; code: string; name: string; timeZone: string; metrics: { appointmentsNext24Hours?: number; appointmentsWithoutArrivalToday?: number; pendingConfirmations?: number; pendingWebsiteEnquiries?: number; openOrders?: number; activeCollections?: number; pendingReceiving?: number; pendingDispatch?: number; openExceptions?: number; overdueLeadFollowups?: number; overdueReportFollowups?: number; openTasks?: number; pendingTaskApprovals?: number; taskApprovalExpiryDue?: number; taskApprovalEscalationDue?: number; overdueTasks?: number; scheduledStaff?: number; staffUnavailable?: number; openEscalations?: number; overdueEscalations?: number; financePendingPayments?: number; financeDisputes?: number; financeRefundRequests?: number }; queue: QueueItem[]; omittedByKind?: Record<string, number> };
const centreHref = (path: string, centreId: string, filters: Record<string, string> = {}) => `${path}?${new URLSearchParams({ centreId, ...filters })}`;

export function CentreOperationsSummary() {
  const [centres, setCentres] = useState<CentreSummary[] | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/branch/operations", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error("summary_unavailable");
        return response.json() as Promise<{ centres: CentreSummary[] }>;
      })
      .then((data) => setCentres(data.centres))
      .catch((reason: unknown) => { if (!(reason instanceof DOMException && reason.name === "AbortError")) setError(true); });
    return () => controller.abort();
  }, []);

  if (error) return <section className="admin-card" role="alert"><h2>Operations summary unavailable</h2><p>Refresh the page or open a permitted work queue directly.</p></section>;
  if (centres === null) return <section className="admin-card" role="status"><p>Loading centre summaries…</p></section>;
  if (!centres.length) return <section className="admin-card"><h2>No centre operations access</h2><p>Ask an Owner to review your centre assignments and operational permissions.</p></section>;

  return <div className="centre-operations-list">
    <p className="admin-muted">Counts only. Patient names and private appointment, financial, sample or report details are not included.</p>
    {centres.map((centre) => <section className="admin-card centre-operations-card" key={centre.id}>
      <div><p className="eyebrow">{centre.code} · {centre.timeZone}</p><h2>{centre.name}</h2></div>
      <dl className="centre-operations-metrics">
        {centre.metrics.appointmentsNext24Hours !== undefined && <div><dt>Appointments · next 24 hours</dt><dd>{centre.metrics.appointmentsNext24Hours}</dd></div>}
        {centre.metrics.appointmentsWithoutArrivalToday !== undefined && <div><dt>Confirmed centre visits without recorded arrival today</dt><dd>{centre.metrics.appointmentsWithoutArrivalToday}</dd></div>}
        {centre.metrics.pendingConfirmations !== undefined && <div><dt>Pending confirmations</dt><dd>{centre.metrics.pendingConfirmations}</dd></div>}
        {centre.metrics.pendingWebsiteEnquiries !== undefined && <div><dt>Website enquiries pending review</dt><dd>{centre.metrics.pendingWebsiteEnquiries}</dd></div>}
        {centre.metrics.openOrders !== undefined && <div><dt>Orders awaiting confirmation</dt><dd>{centre.metrics.openOrders}</dd></div>}
        {centre.metrics.activeCollections !== undefined && <div><dt>Active collection jobs</dt><dd>{centre.metrics.activeCollections}</dd></div>}
        {centre.metrics.pendingReceiving !== undefined && <div><dt>Samples awaiting Rudra receiving</dt><dd>{centre.metrics.pendingReceiving}</dd></div>}
        {centre.metrics.pendingDispatch !== undefined && <div><dt>Samples awaiting dispatch</dt><dd>{centre.metrics.pendingDispatch}</dd></div>}
        {centre.metrics.openExceptions !== undefined && <div><dt>Open sample exceptions</dt><dd>{centre.metrics.openExceptions}</dd></div>}
        {centre.metrics.overdueLeadFollowups !== undefined && <div><dt>Overdue lead follow-ups</dt><dd>{centre.metrics.overdueLeadFollowups}</dd></div>}
        {centre.metrics.overdueReportFollowups !== undefined && <div><dt>Overdue report follow-ups</dt><dd>{centre.metrics.overdueReportFollowups}</dd></div>}
        {centre.metrics.openTasks !== undefined && <div><dt>Open staff tasks</dt><dd>{centre.metrics.openTasks}</dd></div>}
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
        {centre.metrics.pendingWebsiteEnquiries !== undefined && <Link href="/leads/public-enquiries">Review website enquiries</Link>}
        {centre.metrics.appointmentsWithoutArrivalToday !== undefined && <Link href={centreHref("/appointments/arrivals", centre.id)}>Open arrival queue</Link>}
        {centre.metrics.openOrders !== undefined && <Link href={centreHref("/orders", centre.id)}>Open orders</Link>}
        {centre.metrics.activeCollections !== undefined && <Link href="/collections">Open collections</Link>}
        {centre.metrics.pendingReceiving !== undefined && <Link href="/branch/receiving">Open receiving queue</Link>}
        {centre.metrics.pendingDispatch !== undefined && <Link href="/branch/dispatch">Open dispatch queue</Link>}
        {centre.metrics.openExceptions !== undefined && <Link href="/samples/exceptions">Review exceptions</Link>}
        {centre.metrics.overdueLeadFollowups !== undefined && <Link href="/leads/followups">Open lead follow-ups</Link>}
        {centre.metrics.overdueReportFollowups !== undefined && <Link href="/reports/followups">Open report follow-ups</Link>}
        {centre.metrics.openTasks !== undefined && <Link href="/tasks">Open staff tasks</Link>}
        {centre.metrics.taskApprovalExpiryDue !== undefined && <Link href="/tasks/approvals?queue=expiry-due">Review expired approvals</Link>}
        {centre.metrics.taskApprovalEscalationDue !== undefined && <Link href="/tasks/approvals?queue=escalation-due">Review task approval escalations</Link>}
        {centre.metrics.openEscalations !== undefined && <Link href="/escalations">Open escalation queue</Link>}
        {centre.metrics.financePendingPayments !== undefined && <Link href="/finance">Open accounts workbench</Link>}
        {centre.metrics.scheduledStaff !== undefined && <Link href="/roster">Open staff roster</Link>}
      </nav>
    </section>)}
  </div>;
}
