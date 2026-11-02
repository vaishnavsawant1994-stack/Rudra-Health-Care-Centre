"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { json } from "@/lib/http";

type Type = "DOCTOR" | "CORPORATE" | "PARTNER";
type Centre = { id: string; name: string; code: string };
type Referral = { sourceId: string; sourceNumber: string; descriptor: string; status: string; leads: number; converted: number };
type Props = { scopes: Record<Type, string[] | null> };
const typeLabels: Record<Type, string> = { DOCTOR: "Doctors", CORPORATE: "Corporate clients", PARTNER: "Partners" };

export function ReferralAttributionReport({ scopes }: Props) {
  const availableTypes = useMemo(() => (Object.keys(scopes) as Type[]).filter((type) => scopes[type] === null || scopes[type]!.length > 0), [scopes]);
  const [type, setType] = useState<Type>(availableTypes[0] ?? "DOCTOR");
  const [centres, setCentres] = useState<Centre[]>([]);
  const [centreId, setCentreId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [rows, setRows] = useState<Referral[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Select a centre to review attributed referrals.");

  const scopedCentres = useMemo(() => centres.filter((centre) => scopes[type] === null || scopes[type]!.includes(centre.id)), [centres, scopes, type]);

  useEffect(() => {
    let active = true;
    void fetch("/api/leads/centres", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json() as { centres?: Centre[] } }))
      .then(({ response, body }) => { if (!active) return; const list = response.ok ? body.centres ?? [] : []; setCentres(list); const allowed = list.filter((centre) => scopes[type] === null || scopes[type]!.includes(centre.id)); setCentreId((current) => allowed.some((centre) => centre.id === current) ? current : allowed[0]?.id ?? ""); setMessage(allowed.length ? "Select a centre to review attributed referrals." : "No centre is shared by your lead and relationship read permissions."); })
      .catch(() => { if (active) setMessage("Authorized centre list is unavailable."); });
    return () => { active = false; };
  }, [scopes, type]);

  const load = useCallback(async (requestedPage: number, filters?: { from: string; to: string }) => {
    if (!centreId) return;
    if (Boolean(filters?.from) !== Boolean(filters?.to)) { setMessage("Enter both dates, or clear both date filters."); return; }
    setBusy(true); setMessage("Loading referral attribution…");
    const query = new URLSearchParams({ centreId, type, page: String(requestedPage), pageSize: "25" });
    if (filters?.from && filters.to) { query.set("from", filters.from); query.set("to", filters.to); }
    try {
      const { response, body } = await json<{ referrals?: Referral[]; page?: number; hasMore?: boolean; error?: string }>(`/api/relationships/referrals?${query.toString()}`);
      if (!response.ok) { setRows([]); setHasMore(false); setMessage(body.error === "forbidden" ? "Your role does not have both lead and relationship read access for this centre." : body.error === "invalid_date_range" ? "Use a valid date range of at most 366 days." : "Referral attribution could not be loaded."); return; }
      setRows(body.referrals ?? []); setPage(body.page ?? requestedPage); setHasMore(body.hasMore === true); setMessage(body.referrals?.length ? "Referral attribution loaded. Patient and contact details are not included." : "No attributed leads match these filters.");
    } catch { setRows([]); setHasMore(false); setMessage("Referral attribution service is unavailable."); }
    finally { setBusy(false); }
  }, [centreId, type]);

  function apply(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void load(1, { from, to }); }
  function changeType(next: Type) { setType(next); setRows([]); setPage(1); setCentreId(""); }

  if (!availableTypes.length) return <section className="admin-card"><h2>Referral attribution</h2><p>This workspace requires lead-read access and read access to at least one doctor, corporate or partner relationship in the same centre.</p></section>;

  return <section className="admin-card" aria-labelledby="referral-report-title">
    <h2 id="referral-report-title">Referral source attribution</h2>
    <p>Counts are based on CRM leads linked to a doctor, corporate client or partner. Converted counts reflect patient conversions recorded in Rudra; they do not represent revenue, clinical outcomes or external partner settlements.</p>
    <form className="task-toolbar" onSubmit={apply}>
      <label>Source type<select value={type} onChange={(event) => changeType(event.target.value as Type)}>{availableTypes.map((item) => <option key={item} value={item}>{typeLabels[item]}</option>)}</select></label>
      <label>Centre<select value={centreId} onChange={(event) => { setCentreId(event.target.value); setRows([]); setPage(1); }}><option value="">Select centre</option>{scopedCentres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name} ({centre.code})</option>)}</select></label>
      <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
      <button className="button button-primary" disabled={busy || !centreId}>Apply filters</button>
    </form>
    <p role="status" aria-live="polite">{message}</p>
    {rows.length > 0 && <><div className="table-scroll"><table><thead><tr><th>Source</th><th>Category</th><th>Status</th><th>Attributed leads</th><th>Converted to patients</th><th>Conversion rate</th></tr></thead><tbody>{rows.map((row) => {
      return <tr key={row.sourceId}><td>{row.sourceNumber}</td><td>{row.descriptor}</td><td>{row.status}</td><td>{row.leads}</td><td>{row.converted}</td><td>{row.leads ? `${((row.converted / row.leads) * 100).toFixed(1)}%` : "—"}</td></tr>;
    })}</tbody></table></div><nav className="task-pagination" aria-label="Referral report pages"><button type="button" className="button button-secondary" disabled={busy || page <= 1} onClick={() => void load(page - 1, { from, to })}>Previous</button><span>Page {page}</span><button type="button" className="button button-secondary" disabled={busy || !hasMore} onClick={() => void load(page + 1, { from, to })}>Next</button></nav></>}
    <p>Use the Doctors, Corporate clients or Partners navigation to open a relationship directory.</p>
  </section>;
}
