"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { PermissionGrant } from "@/server/permissions";

type Segment = { status: string; category?: string; count: number };
type PipelineData = { relationships: Record<string, Segment[]>; contractStages: string };
const links = [
  ["/relationships/doctors", "Doctor directory", "doctors.read"],
  ["/relationships/corporate", "Corporate accounts", "corporate.read"],
  ["/relationships/partners", "Protected partner directory", "partners.read"],
] as const;

export function RelationshipPipeline({ grants }: { grants: readonly PermissionGrant[] }) {
  const [data, setData] = useState<PipelineData | null>(null);
  const [message, setMessage] = useState("Loading authorized relationship summaries…");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    void fetch("/api/relationships/pipeline", { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Relationship summary unavailable.");
      if (active) { setData(body as PipelineData); setMessage(""); }
    }).catch(error => { if (active) setMessage(error instanceof Error ? error.message : "Relationship summary unavailable."); });
    return () => { active = false; };
  }, [retry]);
  const totalFor = (key: string) => (data?.relationships[key] ?? []).reduce((sum, value) => sum + value.count, 0);
  return <div className="admin-grid">
    <section className="admin-card"><h2>Authorized relationship records</h2><p>Aggregate counts only; this endpoint returns no contact or patient details. Counts reflect directory records, not verified professionals, active contracts, referrals, or revenue.</p>
      {message ? <><p role="status">{message}</p><button className="button button-secondary" onClick={() => setRetry(value => value + 1)}>Retry</button></> : <div className="summary-grid">
        {links.map(([href, title, permission]) => grants.some(grant => grant.key === permission) ? <article key={href}><strong>{totalFor(permission === "doctors.read" ? "doctors" : permission === "corporate.read" ? "corporate" : "partners")}</strong><span>{title}</span><Link href={href}>Open scoped records</Link></article> : null)}
      </div>}
    </section>
    <section className="admin-card"><h2>Pipeline and contract status</h2><p>Relationship profiles currently store ACTIVE/INACTIVE state. Proposal, contract signature, employee camp capacity, billing authorization and partner onboarding stages are not modeled as authoritative states here.</p><p>Contract pipeline: <strong>Unavailable pending approved contract workflow</strong></p><p>Referral and conversion counts belong to the protected referral report and require overlapping centre permissions.</p><Link className="button button-secondary" href="/relationships/referrals">Open referral attribution</Link></section>
  </div>;
}
