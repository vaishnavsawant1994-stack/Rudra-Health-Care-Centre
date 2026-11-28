"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PermissionGrant } from "@/server/permissions";

type Segment = { status: string; category?: string; count: number };
type PipelineData = { relationships: Record<string, Segment[]>; contractStages: string };
type Centre = { id: string; name: string; code: string };
const links = [
  ["/relationships/doctors", "Doctor directory", "doctors.read"],
  ["/relationships/corporate", "Corporate accounts", "corporate.read"],
  ["/relationships/partners", "Protected partner directory", "partners.read"],
] as const;

export function RelationshipPipeline({ grants }: { grants: readonly PermissionGrant[] }) {
  const [data, setData] = useState<PipelineData | null>(null);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [centreId, setCentreId] = useState("");
  const [message, setMessage] = useState("Loading authorized relationship summaries…");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const endpoints = [
      ...(grants.some(grant => grant.key === "doctors.read") ? ["/api/doctors/centres"] : []),
      ...(grants.some(grant => grant.key === "corporate.read") ? ["/api/business-relationships/centres?type=CORPORATE"] : []),
      ...(grants.some(grant => grant.key === "partners.read") ? ["/api/business-relationships/centres?type=PARTNER"] : []),
    ];
    void Promise.all(endpoints.map(async endpoint => {
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = await response.json() as { centres?: Centre[] };
      if (!response.ok) return [];
      return body.centres ?? [];
    })).then(lists => {
      if (!active) return;
      const unique = new Map<string, Centre>();
      for (const centre of lists.flat()) unique.set(centre.id, centre);
      setCentres([...unique.values()].sort((a, b) => a.name.localeCompare(b.name)));
    }).catch(() => { if (active) setCentres([]); });
    return () => { active = false; };
  }, [grants]);
  useEffect(() => {
    let active = true;
    const query = centreId ? `?centreId=${encodeURIComponent(centreId)}` : "";
    void fetch(`/api/relationships/pipeline${query}`, { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error("Relationship summary unavailable for this centre.");
      if (active) { setData(body as PipelineData); setMessage(""); }
    }).catch(() => { if (active) setMessage("Relationship summary could not be loaded. Retry to check the current authorized data."); });
    return () => { active = false; };
  }, [centreId, retry]);
  const totalFor = (key: string) => (data?.relationships[key] ?? []).reduce((sum, value) => sum + value.count, 0);
  const canView = (permission: string) => grants.some(grant => grant.key === permission && (grant.centreId === null || !centreId || grant.centreId === centreId));
  return <div className="admin-grid">
    <section className="admin-card"><h2>Authorized relationship records</h2><p>Aggregate counts only; this endpoint returns no contact or patient details. Counts reflect directory records, not verified professionals, active contracts, referrals, or revenue.</p>
      <label>Centre<select aria-label="Relationship pipeline centre" value={centreId} onChange={event => { setData(null); setMessage("Loading authorized relationship summaries…"); setCentreId(event.target.value); }}><option value="">All authorized centres</option>{centres.map(centre => <option key={centre.id} value={centre.id}>{centre.name} ({centre.code})</option>)}</select></label>
      {message ? <><p role="status" aria-live="polite">{message}</p>{message.includes("could not be loaded") && <button className="button button-secondary" onClick={() => { setData(null); setMessage("Loading authorized relationship summaries…"); setRetry(value => value + 1); }}>Retry</button>}</> : <div className="summary-grid">
        {links.map(([href, title, permission]) => canView(permission) ? <article key={href}><strong>{totalFor(permission === "doctors.read" ? "doctors" : permission === "corporate.read" ? "corporate" : "partners")}</strong><span>{title}</span><Link href={href}>Open scoped records</Link></article> : null)}
      </div>}
    </section>
    <section className="admin-card"><h2>Pipeline and contract status</h2><p>Relationship profiles currently store ACTIVE/INACTIVE state. Proposal, contract signature, employee camp capacity, billing authorization and partner onboarding stages are not modeled as authoritative states here.</p><p>Contract pipeline: <strong>Unavailable pending approved contract workflow</strong></p><p>Referral and conversion counts belong to the protected referral report and require overlapping centre permissions.</p><Link className="button button-secondary" href="/relationships/referrals">Open referral attribution</Link></section>
  </div>;
}
