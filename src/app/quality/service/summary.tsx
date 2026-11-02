"use client";

import { useEffect, useState } from "react";

type Summary = { open: number; inProgress: number; awaitingApproval: number; completed: number; overdue: number };
export function ServiceQualitySummary() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    fetch("/api/quality/service", { cache: "no-store" }).then(async (response) => {
      const body = await response.json() as { summary?: Summary };
      if (!response.ok || !body.summary) throw new Error("unavailable");
      if (active) setSummary(body.summary);
    }).catch(() => { if (active) setError("Service quality summary is unavailable. The support work queue remains available below."); });
    return () => { active = false; };
  }, []);
  return <section className="admin-card" aria-labelledby="service-quality-summary"><h2 id="service-quality-summary">Service issue workload</h2>{error && <p role="status">{error}</p>}{!summary && !error && <p role="status">Loading authorized centre summary…</p>}{summary && <dl className="sample-stat-grid">{([['Open', summary.open], ['In progress', summary.inProgress], ['Awaiting task approval', summary.awaitingApproval], ['Overdue', summary.overdue], ['Completed', summary.completed]] as const).map(([label, value]) => <div className="admin-card" key={label}><dt>{label}</dt><dd><strong>{value}</strong></dd></div>)}</dl>}<p>Counts include only support tasks in your authorized centre scope. No patient or complaint details are included here.</p></section>;
}
