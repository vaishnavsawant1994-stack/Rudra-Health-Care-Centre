"use client";

import { useCallback, useEffect, useState } from "react";

type Centre = { id: string; name: string; code: string };
type Summary = { from: string; to: string; total: number; converted: number; conversionRate: number | null; bySource: Array<{ key: string; count: number }>; byStatus: Array<{ key: string; count: number }>; byCentre: Array<{ id: string; name: string; count: number }> };
const label = (value: string) => value.replaceAll("_", " ").toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase());

export function LeadAnalytics() {
  const [centres, setCentres] = useState<Centre[]>([]); const [centreId, setCentreId] = useState("");
  const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const [summary, setSummary] = useState<Summary | null>(null);
  const [message, setMessage] = useState("Loading authorized CRM summary…"); const [busy, setBusy] = useState(false);
  const load = useCallback(async (nextCentre = centreId, nextFrom = from, nextTo = to) => {
    setBusy(true); setMessage("Loading an aggregate summary…");
    try {
      const response = await fetch("/api/leads/centres", { cache: "no-store" });
      const body = await response.json() as { centres?: Centre[] };
      if (!response.ok) throw new Error();
      const allowed = body.centres ?? []; setCentres(allowed);
      const params = new URLSearchParams(); if (nextCentre) params.set("centreId", nextCentre); if (nextFrom) params.set("from", nextFrom); if (nextTo) params.set("to", nextTo);
      const result = await fetch(`/api/leads/analytics?${params}`, { cache: "no-store" });
      const data = await result.json() as Summary & { error?: string };
      if (!result.ok) { setSummary(null); setMessage(data.error === "invalid_date_range" || data.error === "date_range_too_large" ? "Choose a valid date range of at most 366 days." : "CRM summary is unavailable in your permission scope."); return; }
      setSummary(data); setMessage(data.total ? `Showing ${data.from} through ${data.to}. Counts contain no lead contact details.` : `No CRM leads were created from ${data.from} through ${data.to}.`);
    } catch { setSummary(null); setMessage("CRM summary could not be loaded. Retry when the service is available."); }
    finally { setBusy(false); }
  }, [centreId, from, to]);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);
  return <section className="admin-card">
    <p>Aggregate lead counts only. This view does not expose names, contact details, notes, campaign text or individual lead records. Conversion rate uses leads created in the selected period as its denominator.</p>
    <div className="lead-analytics-filters">
      <label>Centre<select value={centreId} onChange={(event) => setCentreId(event.target.value)}><option value="">All authorized centres</option>{centres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name} ({centre.code})</option>)}</select></label>
      <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>Through<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button className="button button-secondary" disabled={busy} onClick={() => void load()}>Apply filters</button>
      <button className="button button-secondary" disabled={busy} onClick={() => { setCentreId(""); setFrom(""); setTo(""); void load("", "", ""); }}>Reset</button>
    </div>
    <p role="status" aria-live="polite">{busy ? "Loading…" : message}</p>
    {summary && <>
      <div className="lead-analytics-summary"><article><span>Leads created</span><strong>{summary.total}</strong></article><article><span>Converted to patient</span><strong>{summary.converted}</strong></article><article><span>Conversion rate</span><strong>{summary.conversionRate === null ? "—" : `${summary.conversionRate}%`}</strong></article></div>
      <div className="lead-analytics-tables"><section><h2>By source</h2>{summary.bySource.length ? <table className="admin-table"><thead><tr><th>Source</th><th>Leads</th></tr></thead><tbody>{summary.bySource.map((row) => <tr key={row.key}><td>{label(row.key)}</td><td>{row.count}</td></tr>)}</tbody></table> : <p>No source data for this period.</p>}</section>
        <section><h2>By status</h2>{summary.byStatus.length ? <table className="admin-table"><thead><tr><th>Status</th><th>Leads</th></tr></thead><tbody>{summary.byStatus.map((row) => <tr key={row.key}><td>{label(row.key)}</td><td>{row.count}</td></tr>)}</tbody></table> : <p>No status data for this period.</p>}</section>
        {!centreId && summary.byCentre.length > 1 && <section><h2>By authorized centre</h2><table className="admin-table"><thead><tr><th>Centre</th><th>Leads</th></tr></thead><tbody>{summary.byCentre.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.count}</td></tr>)}</tbody></table></section>}
      </div>
    </>}
  </section>;
}
