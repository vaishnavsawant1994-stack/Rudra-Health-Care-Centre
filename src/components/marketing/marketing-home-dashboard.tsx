"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";

type Centre = { id: string; code: string; name: string };
type Campaign = { id: string; status: string; attributedLeadCount: number; convertedLeadCount: number; appointmentCount: number };
type ContentItem = { id: string; status: string; title: string; channel: string; plannedPublishAt: string | null };

export function MarketingHomeDashboard() {
  const [centres, setCentres] = useState<Centre[]>([]);
  const [centreId, setCentreId] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [content, setContent] = useState<ContentItem[]>([]);
  const [message, setMessage] = useState("Loading authorized marketing records…");
  const latestRequest = useRef(0);

  const load = useCallback(async (id: string) => {
    if (!id) return;
    const requestId = ++latestRequest.current;
    setCampaigns([]);
    setContent([]);
    setMessage("Loading centre-scoped campaign and content records…");
    try {
      const [campaignResponse, contentResponse] = await Promise.all([
        fetch(`/api/marketing/campaigns?${new URLSearchParams({ centreId: id })}`, { cache: "no-store" }),
        fetch(`/api/marketing/content?${new URLSearchParams({ centreId: id, status: "ALL" })}`, { cache: "no-store" }),
      ]);
      const [campaignBody, contentBody] = await Promise.all([
        campaignResponse.json() as Promise<{ campaigns?: Campaign[] }>,
        contentResponse.json() as Promise<{ items?: ContentItem[] }>,
      ]);
      if (requestId !== latestRequest.current) return;
      if (!campaignResponse.ok || !contentResponse.ok) throw new Error("unavailable");
      setCampaigns(campaignBody.campaigns ?? []);
      setContent(contentBody.items ?? []);
      setMessage("");
    } catch {
      if (requestId !== latestRequest.current) return;
      setCampaigns([]); setContent([]); setMessage("Marketing records could not be loaded for this authorized centre. Retry or verify access.");
    }
  }, []);

  useEffect(() => {
    let active = true;
    void fetch("/api/marketing/centres", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json() as { centres?: Centre[] } })).then(({ response, body }) => {
      if (!active) return;
      const available = response.ok ? body.centres ?? [] : [];
      setCentres(available); setCentreId(available[0]?.id ?? "");
      if (available[0]) void load(available[0].id);
      else setMessage("No centre is available under your marketing read permission.");
    }).catch(() => { if (active) setMessage("Marketing summary is unavailable."); });
    return () => { active = false; latestRequest.current += 1; };
  }, [load]);

  const countStatus = (status: string) => content.filter((item) => item.status === status).length;
  const totalLeads = campaigns.reduce((sum, item) => sum + item.attributedLeadCount, 0);
  const totalConversions = campaigns.reduce((sum, item) => sum + item.convertedLeadCount, 0);
  const totalAppointments = campaigns.reduce((sum, item) => sum + item.appointmentCount, 0);
  return <>
    <nav className="page-actions" aria-label="Canonical Phase 09 marketing screens">
      {[ ["M002", "Account health", "/marketing/accounts"], ["M003", "Content studio", "/marketing/studio"], ["M005", "Editorial calendar", "/marketing/calendar"], ["M006", "Approvals", "/marketing/approvals"], ["M007", "Publishing preparation", "/marketing/publishing"], ["M012", "Campaigns", "/marketing/campaigns"], ["M017", "Attribution", "/marketing/attribution"] ].map(([id, label, href]) => <Link key={id} className="button button-secondary" href={href}>{id} · {label}</Link>)}
      <Link className="button button-secondary" href="/marketing/design/m001">Synthetic design preview</Link>
    </nav>
    <section className="admin-card">
      <div className="task-toolbar"><div><h2>Recorded marketing activity</h2><p>Centre-scoped campaign, lead, conversion, appointment and content records only. No external reach, views, engagement, advertising spend, payment or diagnostic completion is inferred.</p></div><label>Authorized centre<select aria-label="Marketing dashboard centre" value={centreId} onChange={(event) => { const nextCentreId = event.target.value; setCentreId(nextCentreId); void load(nextCentreId); }}>{centres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name} ({centre.code})</option>)}</select></label></div>
      {message && <p role="status">{message}</p>}
      {message.includes("could not be loaded") && <button type="button" className="button button-secondary" onClick={() => void load(centreId)}>Retry</button>}
      {!message && <>
        <div className="marketing-summary-grid" role="region" aria-label="Recorded marketing summary">
          {[ ["Campaign records", campaigns.length], ["Draft content", countStatus("DRAFT")], ["In review", countStatus("IN_REVIEW")], ["Scheduled plans", countStatus("SCHEDULED")], ["Attributed leads", totalLeads], ["Recorded conversions", totalConversions], ["Linked appointments", totalAppointments] ].map(([label, value]) => <article className="admin-card" key={String(label)}><strong>{value}</strong><span>{label}</span><small>From Rudra records</small></article>)}
        </div>
        <h3>Recent internal content records</h3>
        {content.length === 0 ? <p>No content records are recorded for this centre.</p> : <div className="table-scroll"><table className="admin-table"><thead><tr><th>Title</th><th>Channel</th><th>State</th><th>Planned date</th></tr></thead><tbody>{content.slice(0, 10).map((item) => <tr key={item.id}><td>{item.title}</td><td>{item.channel}</td><td>{item.status}</td><td>{item.plannedPublishAt ? new Date(item.plannedPublishAt).toLocaleString() : "No planned date"}</td></tr>)}</tbody></table></div>}
      </>}
      <p role="note">Provider connections: NOT CONFIGURED · publishing: DISABLED · advertising spend: DISABLED · social metrics: NOT AVAILABLE</p>
    </section>
  </>;
}
