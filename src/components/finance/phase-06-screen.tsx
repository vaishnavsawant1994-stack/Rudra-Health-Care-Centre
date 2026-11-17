"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Screen = "billing" | "quotes" | "invoice" | "metropolis" | "home-fees" | "partners" | "expenses" | "analytics" | "disputes";
type Data = {
  charges: Array<{ id: string; centreId: string; chargeType: string; chargeCode: string; amountMinor: string; paidMinor: string; state: string; disputed: boolean }>;
  payments: Array<{ id: string; paymentNumber: string; centreId: string; status: string; amountMinor: string; method: string }>;
  summary: Record<string, string | number>;
};
const unavailable: Partial<Record<Screen, string>> = {
  quotes: "Quote creation is currently available inside the authorized lead workflow. This route cannot edit a quote without its lead and catalogue-version context.",
  invoice: "There is no legal invoice issuance or invoice-document entity in the active finance contract. Issuer and tax policy are pending; no invoice is created here.",
  metropolis: "No verified Metropolis invoice, remittance, settlement terms or reconciliation source is configured. Imported statements and settlement totals are unavailable.",
  partners: "Corporate billing is gated until an approved contract, credit terms, authorized issuer and centre-scoped billing policy exist.",
  expenses: "Expense and petty-cash recording is gated until approved categories, evidence retention, approvers and accounting treatment are configured.",
};
const money = (value: string | number | undefined) => value === undefined ? "—" : `₹${(Number(value) / 100).toFixed(2)}`;

export function FinancePhase06Screen({ screen }: { screen: Screen }) {
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState("Loading centre-scoped finance records…");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void fetch("/api/finance", { cache: "no-store" }).then(async response => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Finance records could not be loaded.");
      if (active) { setData(body as Data); setMessage(""); }
    }).catch(error => { if (active) setMessage(error instanceof Error ? error.message : "Finance records could not be loaded."); });
    return () => { active = false; };
  }, [attempt]);
  const charges = data?.charges ?? [];
  const payments = data?.payments ?? [];
  const listedCharges = screen === "home-fees" ? charges.filter(item => item.chargeType === "HOME_COLLECTION")
    : screen === "disputes" ? charges.filter(item => item.disputed) : charges;
  const listedPayments = screen === "disputes" ? payments.filter(item => item.status === "DISPUTED") : payments;
  const gated = unavailable[screen];
  return <div className="admin-workspace">
    <nav className="admin-nav" aria-label="Finance screens">
      <Link href="/finance">Overview</Link><Link href="/finance/payments">Payments and allocations</Link>
      <Link href="/finance/outstanding">Outstanding dues</Link><Link href="/finance/refunds">Refunds</Link>
      <Link href="/finance/reconciliation">Cash and UPI close</Link><Link href="/finance/policies">Issuer policy</Link>
    </nav>
    {gated && <section className="admin-card" role="status"><h2>Restricted pending verified business rules</h2><p>{gated}</p><p>Existing records remain unchanged. This screen does not create, issue, import or reconcile external financial documents.</p></section>}
    {message ? <section className="admin-card" role="status"><p>{message}</p><button className="button button-secondary" onClick={() => setAttempt(value => value + 1)}>Retry</button></section> : <>
      {!gated && <section className="admin-card"><h2>Current finance snapshot</h2><p>Centre-scoped internal records only. These are not provider settlements or tax invoices.</p><div className="summary-grid">
        <article><strong>{data?.summary.activeCharges ?? 0}</strong><span>Active charge records</span></article>
        <article><strong>{money(data?.summary.activeChargeMinor)}</strong><span>Recorded charge total</span></article>
        <article><strong>{data?.summary.pendingPayments ?? 0}</strong><span>Payment evidence awaiting review</span></article>
        <article><strong>{data?.summary.disputedPayments ?? 0}</strong><span>Disputed payment records</span></article>
      </div></section>}
      {listedCharges.length > 0 && <section className="admin-card"><h2>{screen === "home-fees" ? "Recorded Rudra home-collection charges" : screen === "disputes" ? "Charges linked to disputed payments" : "Existing charge records"}</h2><div className="table-scroll"><table className="admin-table"><thead><tr><th>Internal charge</th><th>Type</th><th>Amount</th><th>Recorded balance paid</th><th>State</th></tr></thead><tbody>{listedCharges.map(item => <tr key={item.id}><td>{item.chargeCode}</td><td>{item.chargeType}</td><td>{money(item.amountMinor)}</td><td>{money(item.paidMinor)}</td><td>{item.state}</td></tr>)}</tbody></table></div></section>}
      {listedPayments.length > 0 && <section className="admin-card"><h2>Existing payment records requiring review</h2><div className="table-scroll"><table className="admin-table"><thead><tr><th>Internal reference</th><th>Method</th><th>Amount</th><th>Record state</th><th>Review</th></tr></thead><tbody>{listedPayments.map(item => <tr key={item.id}><td>{item.paymentNumber}</td><td>{item.method}</td><td>{money(item.amountMinor)}</td><td>{item.status}</td><td><Link href={`/finance/payments/${item.id}`}>Open protected record</Link></td></tr>)}</tbody></table></div></section>}
      {!listedCharges.length && !listedPayments.length && <section className="admin-card" role="status"><p>No matching finance records are available in the authorized scope.</p></section>}
      {screen === "analytics" && <section className="admin-card"><h2>Export availability</h2><p>Export is unavailable until a scoped finance export permission, privacy review and immutable export audit contract are approved.</p></section>}
      {screen === "billing" && <section className="admin-card"><h2>Supported billing actions</h2><p>Authorized staff can create internal charge snapshots from confirmed orders. Legal invoice issuance remains disabled.</p><Link className="button button-secondary" href="/finance/outstanding">Review outstanding charges</Link></section>}
    </>}
  </div>;
}
