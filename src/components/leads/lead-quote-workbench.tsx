"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { IdempotencyAttempt } from "@/lib/idempotency-attempt";
import type { PermissionGrant } from "@/server/permissions";

type Centre = { id: string; code: string; name: string; timeZone: string };
type Lead = { id: string; leadNumber: string; firstName: string; lastName: string; status: string };
type CatalogueItem = { id: string; versionId: string; serviceType: string; serviceCode: string; displayName: string; verificationStatus: string; verifiedPrice: string | null; currency: string; priceSourceReference: string | null; effectiveFrom: string | null; effectiveUntil: string | null };
type Quote = { id: string; quoteNumber: string; versionNumber: number; status: string; currency: string; diagnosticTotalPaise: number; homeVisitFeePaise: number; totalPaise: number; snapshot: { lines: Array<{ catalogueVersionId: string; displayName: string; serviceCode: string; versionNumber: number; pricePaise: number }>; promotion: string; visitType: string; homeVisitFeeReason: string | null }; createdAt: string };
const priceToPaise = (price: string | null) => { if (!price || !/^(0|[1-9]\d{0,9})(\.\d{1,2})?$/.test(price)) return null; const [rupees, fraction = ""] = price.split("."); const value = Number(rupees) * 100 + Number(fraction.padEnd(2, "0")); return Number.isSafeInteger(value) ? value : null; };
const money = (paise: number) => `₹${Math.floor(paise / 100).toLocaleString("en-IN")}.${String(paise % 100).padStart(2, "0")}`;
const json = async <T,>(response: Response) => response.json().catch(() => ({})) as Promise<T>;
function todayAt(timeZone: string) { const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()); const values = Object.fromEntries(parts.map((part) => [part.type, part.value])); return `${values.year}-${values.month}-${values.day}`; }

export function LeadQuoteWorkbench({ grants, initialLeadId = "" }: { grants: readonly PermissionGrant[]; initialLeadId?: string }) {
  const [centres, setCentres] = useState<Centre[]>([]); const [centreId, setCentreId] = useState(""); const [leads, setLeads] = useState<Lead[]>([]); const [leadId, setLeadId] = useState(initialLeadId);
  const [catalogue, setCatalogue] = useState<CatalogueItem[]>([]); const [selected, setSelected] = useState<string[]>([]); const [visitType, setVisitType] = useState<"CENTRE" | "HOME_COLLECTION">("CENTRE"); const [fee, setFee] = useState(0); const [feeReason, setFeeReason] = useState("");
  const [quotes, setQuotes] = useState<Quote[]>([]); const [message, setMessage] = useState("Loading authorized centres…"); const [busy, setBusy] = useState(false); const [attempt] = useState(() => new IdempotencyAttempt());
  const inScope = useCallback((key: string, centre: string) => grants.some((grant) => grant.key === key && (grant.centreId === null || grant.centreId === centre)), [grants]);
  const canQuote = Boolean(centreId && ["leads.read", "catalogue.read", "orders.create", "finance.read"].every((key) => inScope(key, centreId)));
  const centre = centres.find((item) => item.id === centreId);
  const effectiveCatalogue = catalogue.filter((item) => {
    if (!centre || item.verifiedPrice === null || item.currency !== "INR" || !item.priceSourceReference || !item.effectiveFrom) return false;
    try { const today = todayAt(centre.timeZone); return item.effectiveFrom <= today && (!item.effectiveUntil || item.effectiveUntil >= today) && priceToPaise(item.verifiedPrice) !== null; } catch { return false; }
  });
  const selectedItems = useMemo(() => effectiveCatalogue.filter((item) => selected.includes(item.versionId)), [effectiveCatalogue, selected]);
  const diagnosticTotal = selectedItems.reduce((sum, item) => sum + (priceToPaise(item.verifiedPrice) ?? 0), 0);

  useEffect(() => { let active = true; void fetch("/api/leads/centres", { cache: "no-store" }).then((r) => json<{ centres?: Centre[] }>(r)).then((data) => { if (!active) return; const rows = data.centres ?? []; setCentres(rows); const selectedCentre = rows.find((item) => grants.some((grant) => grant.key === "finance.read" && (grant.centreId === null || grant.centreId === item.id)) && grants.some((grant) => grant.key === "catalogue.read" && (grant.centreId === null || grant.centreId === item.id)) && grants.some((grant) => grant.key === "orders.create" && (grant.centreId === null || grant.centreId === item.id))); if (selectedCentre) setCentreId(selectedCentre.id); setMessage(rows.length ? "Select a centre to load leads and current verified prices." : "No authorized centre is available."); }).catch(() => setMessage("Centre service is unavailable.")); return () => { active = false; }; }, [grants]);
  useEffect(() => { if (!initialLeadId) return; let active = true; void fetch(`/api/leads/${encodeURIComponent(initialLeadId)}`, { cache: "no-store" }).then((response) => json<{ lead?: { id: string; centreId: string } }>(response)).then((data) => { if (active && data.lead) { setLeadId(data.lead.id); setCentreId(data.lead.centreId); } }).catch(() => { if (active) setMessage("The linked lead is unavailable in your authorized scope."); }); return () => { active = false; }; }, [initialLeadId]);

  const load = useCallback(async (centre: string) => {
    if (!centre) return;
    setMessage("Loading centre-scoped leads and catalogue…"); setQuotes([]); setSelected([]);
    try {
      const [leadResponse, catalogueResponse] = await Promise.all([fetch(`/api/leads?centreId=${encodeURIComponent(centre)}&pageSize=50`, { cache: "no-store" }), fetch(`/api/catalogue?centreId=${encodeURIComponent(centre)}&includeInactive=false`, { cache: "no-store" })]);
      const [leadData, catalogueData] = await Promise.all([json<{ leads?: Lead[] }>(leadResponse), json<{ items?: CatalogueItem[] }>(catalogueResponse)]);
      if (!leadResponse.ok || !catalogueResponse.ok) throw new Error();
      setLeads(leadData.leads ?? []); setCatalogue(catalogueData.items ?? []); setMessage("Only active services with currently effective, verified INR prices can be included.");
    } catch { setLeads([]); setCatalogue([]); setMessage("Lead or catalogue access is unavailable for this centre."); }
  }, []);
  useEffect(() => { const timer = window.setTimeout(() => { void load(centreId); }, 0); return () => window.clearTimeout(timer); }, [centreId, load]);

  const loadQuotes = useCallback(async (id: string) => {
    if (!id) { setQuotes([]); return; }
    try { const response = await fetch(`/api/leads/${encodeURIComponent(id)}/quotes`, { cache: "no-store" }); const body = await json<{ quotes?: Quote[] }>(response); if (!response.ok) throw new Error(); setQuotes(body.quotes ?? []); }
    catch { setQuotes([]); setMessage("Quote history is unavailable or you do not have finance access for this centre."); }
  }, []);
  useEffect(() => { const lead = leads.find((item) => item.id === leadId); if (!lead) return; const timer = window.setTimeout(() => { void loadQuotes(lead.id); }, 0); return () => window.clearTimeout(timer); }, [leadId, leads, loadQuotes]);

  async function createDraft(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!canQuote || !leadId || selected.length === 0) return;
    setBusy(true); setMessage("Creating an immutable internal quote draft…");
    const payload = { catalogueVersionIds: selected, visitType, homeVisitFeePaise: visitType === "CENTRE" ? 0 : fee, ...(visitType === "HOME_COLLECTION" && fee === 0 ? { homeVisitFeeReason: feeReason } : {}) };
    try {
      const body = JSON.stringify(payload); const idempotencyKey = await attempt.keyFor(body);
      const response = await fetch(`/api/leads/${encodeURIComponent(leadId)}/quotes`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body });
      const result = await json<{ quote?: Quote; error?: string; replayed?: boolean }>(response);
      if (!response.ok || !result.quote) { if (response.status < 500) attempt.clear(); const errors: Record<string, string> = { catalogue_selection_unavailable: "A selected service is no longer active or its verified price is not currently effective. Refresh the catalogue.", overlapping_services: "The selected package and tests overlap. Remove duplicates before saving.", idempotency_conflict: "This save key belongs to a different quote request. Refresh and try again.", lead_not_quoteable: "This lead is not eligible for an internal quote." }; setMessage(errors[result.error ?? ""] ?? "Quote draft could not be created. No external message was sent."); return; }
      attempt.clear(); setQuotes((current) => [result.quote!, ...current.filter((item) => item.id !== result.quote!.id)]); setMessage(result.replayed ? "The existing internal quote draft was recovered. No message was sent." : "Internal quote draft saved. It is not approved for customer communication; no message was sent.");
    } catch { setMessage("Quote save could not be confirmed. Retry unchanged details to check whether it was saved."); }
    finally { setBusy(false); }
  }

  return <div className="admin-grid">
    <section className="admin-card"><h2>Prepare an internal price draft</h2><p>Uses only current, centre-scoped verified catalogue prices. Promotions are not configured, so none are applied. This creates an internal snapshot only; customer delivery, order creation, payment and invoicing are disabled here.</p>
      <form className="admin-form" onSubmit={(event) => void createDraft(event)}>
        <label>Centre<select value={centreId} onChange={(event) => { setCentreId(event.target.value); setLeadId(""); }} required><option value="">Choose an authorized centre</option>{centres.map((item) => <option value={item.id} key={item.id}>{item.name} ({item.code})</option>)}</select></label>
        <label>CRM lead<select value={leadId} onChange={(event) => setLeadId(event.target.value)} required><option value="">Choose a lead</option>{leads.filter((lead) => !["CONVERTED", "LOST", "DUPLICATE", "DO_NOT_CONTACT"].includes(lead.status)).map((lead) => <option key={lead.id} value={lead.id}>{lead.leadNumber} · {lead.firstName} {lead.lastName} · {lead.status.replaceAll("_", " ")}</option>)}</select></label>
        <fieldset><legend>Verified catalogue services</legend>{effectiveCatalogue.map((item) => <label className="task-checkbox" key={item.versionId}><input type="checkbox" checked={selected.includes(item.versionId)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, item.versionId] : current.filter((id) => id !== item.versionId))} />{item.displayName} ({item.serviceCode}) · {money(priceToPaise(item.verifiedPrice) ?? 0)}</label>)}{!effectiveCatalogue.length && <p>No currently effective, verified INR catalogue prices are available for this centre.</p>}</fieldset>
        <label>Visit type<select value={visitType} onChange={(event) => { const next = event.target.value as "CENTRE" | "HOME_COLLECTION"; setVisitType(next); if (next === "CENTRE") { setFee(0); setFeeReason(""); } }}><option value="CENTRE">Centre visit</option><option value="HOME_COLLECTION">Home collection</option></select></label>
        {visitType === "HOME_COLLECTION" && <><label>Separate home-visit service charge<select value={fee} onChange={(event) => setFee(Number(event.target.value))}><option value={7500}>₹75.00</option><option value={9900}>₹99.00</option><option value={15000}>₹150.00</option><option value={0}>Waive charge</option></select></label>{fee === 0 && <label>Waiver reason<input value={feeReason} onChange={(event) => setFeeReason(event.target.value)} required minLength={3} maxLength={240} /></label>}</>}
        <dl className="lead-details"><div><dt>Diagnostic price</dt><dd>{money(diagnosticTotal)}</dd></div><div><dt>Home-visit charge</dt><dd>{money(visitType === "CENTRE" ? 0 : fee)}</dd></div><div><dt>Draft total</dt><dd><strong>{money(diagnosticTotal + (visitType === "CENTRE" ? 0 : fee))}</strong></dd></div></dl>
        <button className="button button-primary" disabled={busy || !canQuote || !leadId || selected.length === 0 || (visitType === "HOME_COLLECTION" && fee === 0 && feeReason.trim().length < 3)}>{busy ? "Saving…" : "Save internal quote draft"}</button>
      </form><p role="status" aria-live="polite">{message}</p>
    </section>
    <section className="admin-card"><h2>Quote version history</h2>{quotes.length ? quotes.map((quote) => <article className="admin-card" key={quote.id}><p className="eyebrow">{quote.quoteNumber} · Version {quote.versionNumber} · Internal draft</p><p>{quote.snapshot.lines.map((line) => `${line.displayName} (${line.serviceCode}) ${money(line.pricePaise)}`).join("; ")}</p><p>Diagnostic services {money(quote.diagnosticTotalPaise)} · Separate home visit {money(quote.homeVisitFeePaise)} · Total {money(quote.totalPaise)}</p>{quote.snapshot.homeVisitFeeReason && <p>Waiver reason: {quote.snapshot.homeVisitFeeReason}</p>}<small>Price source is snapshotted by catalogue version. Promotions: not applied pending approved policy. Customer communication is disabled.</small></article>) : <p>No internal quote drafts for this lead.</p>}</section>
  </div>;
}
