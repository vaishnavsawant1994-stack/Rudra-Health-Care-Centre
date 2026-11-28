"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Quote = {
  id: string;
  quoteNumber: string;
  versionNumber: number;
  status: string;
  currency: string;
  diagnosticTotalPaise: number;
  homeVisitFeePaise: number;
  totalPaise: number;
  snapshot: {
    lines: Array<{ serviceCode: string; displayName: string; versionNumber: number; pricePaise: number }>;
    visitType: "CENTRE" | "HOME_COLLECTION";
    homeVisitFeeReason: string | null;
    promotion: string;
  };
  createdAt: string;
};

const money = (paise: number) => `₹${Math.floor(paise / 100).toLocaleString("en-IN")}.${String(paise % 100).padStart(2, "0")}`;

export function FinanceQuoteDetail({ quoteId, leadId }: { quoteId: string; leadId: string }) {
  const [result, setResult] = useState<{ key: string; quote: Quote | null; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const key = `${leadId}:${quoteId}:${attempt}`;

  useEffect(() => {
    let active = true;
    if (!quoteId || !leadId) return () => { active = false; };
    void fetch(`/api/leads/${encodeURIComponent(leadId)}/quotes`, { cache: "no-store" })
      .then(async (response) => ({ response, body: await response.json() as { quotes?: Quote[] } }))
      .then(({ response, body }) => {
        if (!active) return;
        if (!response.ok) throw new Error("quote_unavailable");
        const selected = body.quotes?.find((item) => item.id === quoteId);
        if (!selected) throw new Error("quote_unavailable");
        setResult({ key, quote: selected, message: "" });
      })
      .catch(() => {
        if (active) setResult({ key, quote: null, message: "This quote is unavailable in the authorized lead scope. No quote data was disclosed." });
      });
    return () => { active = false; };
  }, [key, leadId, quoteId]);

  const currentResult = result?.key === key ? result : null;
  const quote = currentResult?.quote ?? null;
  const message = !quoteId || !leadId
    ? "Open this quote from its authorized lead record to verify its scope."
    : currentResult?.message ?? "Loading authorized internal quote…";

  return <div className="admin-workspace">
    <nav className="admin-nav" aria-label="Finance quote navigation">
      <Link href="/finance">Finance overview</Link>
      <Link href="/staff/quotes">Internal quote drafts</Link>
      {leadId && <Link href={`/leads/${encodeURIComponent(leadId)}`}>Authorized lead record</Link>}
    </nav>
    {message && <section className="admin-card" role="status"><p>{message}</p>{quoteId && leadId && <button className="button button-secondary" onClick={() => setAttempt((value) => value + 1)}>Retry</button>}</section>}
    {quote && <>
      <section className="admin-card">
        <p className="eyebrow">{quote.quoteNumber} · Version {quote.versionNumber}</p>
        <h2>Internal quote draft</h2>
        <p role="status">Status: {quote.status}. Customer delivery is disabled; this is not an accepted offer, appointment, order, invoice or payment.</p>
        <p>Lead reference: {leadId}</p>
        <p>Visit type: {quote.snapshot.visitType === "HOME_COLLECTION" ? "Home collection" : "Centre visit"}</p>
        <div className="table-scroll"><table className="admin-table"><thead><tr><th>Service</th><th>Catalogue version</th><th>Price snapshot</th></tr></thead><tbody>{quote.snapshot.lines.map((line, index) => <tr key={`${line.serviceCode}-${index}`}><td>{line.displayName} ({line.serviceCode})</td><td>{line.versionNumber}</td><td>{money(line.pricePaise)}</td></tr>)}</tbody></table></div>
        <dl className="lead-details"><div><dt>Diagnostic services</dt><dd>{money(quote.diagnosticTotalPaise)}</dd></div><div><dt>Separate home-visit service</dt><dd>{money(quote.homeVisitFeePaise)}</dd></div><div><dt>Internal draft total</dt><dd><strong>{money(quote.totalPaise)}</strong></dd></div></dl>
        {quote.snapshot.homeVisitFeeReason && <p>Recorded waiver reason: {quote.snapshot.homeVisitFeeReason}</p>}
        <p>Promotion: not applied ({quote.snapshot.promotion}). Catalogue versions and values are the immutable internal snapshot.</p>
      </section>
    </>}
  </div>;
}
