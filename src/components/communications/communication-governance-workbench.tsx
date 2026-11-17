"use client";

import { useCallback, useEffect, useState } from "react";

type Kind = "PROVIDER_POLICY" | "KNOWLEDGE";
type Channel = "WHATSAPP" | "VOICE";
type Centre = { id: string; name: string; code: string };
type RecordRow = { id: string; centreId: string; recordKind: Kind; channel: Channel | null; status: "DRAFT"; versionNumber: number; privateData: Record<string, unknown>; createdAt: string; updatedAt: string };

export function CommunicationGovernanceWorkbench({ kind, channel, canManage }: { kind: Kind; channel?: Channel; canManage: boolean }) {
  const [centres, setCentres] = useState<Centre[]>([]);
  const [centreId, setCentreId] = useState("");
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [selected, setSelected] = useState<RecordRow | null>(null);
  const [message, setMessage] = useState("Loading authorized centres…");
  const [busy, setBusy] = useState(false);
  const [idempotencyKey, setIdempotencyKey] = useState("");

  const load = useCallback(async (selectedCentre: string) => {
    if (!selectedCentre) return;
    const response = await fetch(`/api/communications/governance?${new URLSearchParams({ centreId: selectedCentre, recordKind: kind })}`, { cache: "no-store" });
    const body = await response.json() as { records?: RecordRow[]; error?: string };
    if (!response.ok) throw new Error(body.error ?? "unavailable");
    setRecords(body.records ?? []);
    setSelected((current) => current && (body.records ?? []).some((row) => row.id === current.id) ? current : null);
    setMessage(body.records?.length ? "" : "No saved governance drafts exist for this centre.");
  }, [kind]);

  useEffect(() => {
    let active = true;
    void fetch("/api/communications/governance/centres", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json() as { centres?: Centre[] } })).then(({ response, body }) => {
      if (!active) return;
      const list = response.ok ? body.centres ?? [] : [];
      setCentres(list); setCentreId(list[0]?.id ?? "");
      if (!list.length) setMessage("No authorized centre is available for communications governance.");
      else void load(list[0]!.id).catch(() => { if (active) setMessage("Governance drafts could not be loaded in the authorized scope."); });
    }).catch(() => { if (active) setMessage("Governance draft service is unavailable."); });
    return () => { active = false; };
  }, [load]);

  function resetDraft() { setSelected(null); setIdempotencyKey(""); }

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!centreId || !canManage) return;
    const form = new FormData(event.currentTarget); setBusy(true); setMessage("Saving encrypted draft…");
    const privateData = kind === "PROVIDER_POLICY" ? {
      displayName: String(form.get("displayName") ?? ""),
      languages: String(form.get("languages") ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean),
      quietHoursStart: String(form.get("quietHoursStart") ?? ""),
      quietHoursEnd: String(form.get("quietHoursEnd") ?? ""),
      routingInstructions: String(form.get("routingInstructions") ?? ""),
      consentRequired: true, humanEscalation: true,
    } : {
      title: String(form.get("title") ?? ""), category: String(form.get("category") ?? "GENERAL_SERVICE"),
      sourceReference: String(form.get("sourceReference") ?? ""), content: String(form.get("content") ?? ""),
      expiresOn: String(form.get("expiresOn") ?? "") || null,
    };
    const key = idempotencyKey || crypto.randomUUID();
    setIdempotencyKey(key);
    const body = { centreId, recordKind: kind, ...(kind === "PROVIDER_POLICY" ? { channel } : {}), privateData, ...(selected ? { expectedVersion: selected.versionNumber } : { idempotencyKey: key }) };
    try {
      const response = await fetch(selected ? `/api/communications/governance/${encodeURIComponent(selected.id)}` : "/api/communications/governance", {
        method: selected ? "PATCH" : "POST", headers: { "content-type": "application/json", ...(selected ? { "idempotency-key": key } : {}) }, body: JSON.stringify(body),
      });
      const result = await response.json() as { record?: RecordRow; error?: string };
      if (!response.ok || !result.record) throw new Error(result.error ?? "unavailable");
      setIdempotencyKey(""); await load(centreId); setMessage("Encrypted draft saved. Provider activation and publication remain disabled.");
    } catch (error) {
      setMessage(error instanceof Error && error.message === "version_conflict" ? "This draft changed in another session. Refresh and review the latest version." : "Draft was not confirmed. Retry with the same form values or refresh to inspect saved state.");
    } finally { setBusy(false); }
  }

  function edit(row: RecordRow) { setSelected(row); setIdempotencyKey(""); setMessage(`Editing draft version ${row.versionNumber}.`); }
  const draft = selected?.privateData ?? {};

  return <section className="admin-card" aria-label={kind === "PROVIDER_POLICY" ? `${channel} policy drafts` : "Knowledge drafts"}>
    <div className="task-toolbar"><div><h2>{kind === "PROVIDER_POLICY" ? `${channel === "WHATSAPP" ? "WhatsApp" : "Voice"} policy drafts` : "Knowledge source drafts"}</h2><p>Drafts are encrypted and versioned. Save does not approve, publish, configure credentials or enable external delivery.</p></div>
      <label>Centre<select value={centreId} onChange={(event) => { const value = event.target.value; setCentreId(value); resetDraft(); void load(value).catch(() => setMessage("Governance drafts could not be loaded in this scope.")); }}><option value="">Select authorized centre</option>{centres.map((item) => <option key={item.id} value={item.id}>{item.name} ({item.code})</option>)}</select></label>
    </div>
    {message && <p role="status">{message}</p>}
    {canManage && <form key={selected ? `${selected.id}:${selected.versionNumber}` : `${kind}:${channel ?? "knowledge"}:new`} className="admin-form" onSubmit={(event) => void save(event)}>
      <h3>{selected ? `Edit draft · version ${selected.versionNumber}` : "Create governance draft"}</h3>
      {kind === "PROVIDER_POLICY" ? <>
        <label>Internal policy name<input name="displayName" minLength={2} maxLength={100} required defaultValue={String(draft.displayName ?? "")} /></label>
        <label>Supported language codes<input name="languages" required defaultValue={Array.isArray(draft.languages) ? draft.languages.join(", ") : "en, hi, mr"} aria-describedby="governance-language-help" /></label><small id="governance-language-help">Use only en, hi and mr. This does not configure a provider voice or channel.</small>
        <label>Quiet-hours start<input name="quietHoursStart" type="time" required defaultValue={String(draft.quietHoursStart ?? "21:00")} /></label>
        <label>Quiet-hours end<input name="quietHoursEnd" type="time" required defaultValue={String(draft.quietHoursEnd ?? "09:00")} /></label>
        <label>Routing and human escalation instructions<textarea name="routingInstructions" minLength={5} maxLength={1000} required defaultValue={String(draft.routingInstructions ?? "")} /></label>
        <p>Consent is required and human escalation is mandatory. These values cannot be turned off here. Credentials, phone numbers, webhook URLs and secret tokens are never collected.</p>
      </> : <>
        <label>Article title<input name="title" minLength={3} maxLength={160} required defaultValue={String(draft.title ?? "")} /></label>
        <label>Content category<select name="category" defaultValue={String(draft.category ?? "GENERAL_SERVICE")}><option value="GENERAL_SERVICE">General service information</option><option value="CLINICAL">Clinical · draft only</option></select></label>
        <label>Source reference<input name="sourceReference" minLength={3} maxLength={300} required defaultValue={String(draft.sourceReference ?? "")} /></label>
        <label>Draft content<textarea name="content" minLength={20} maxLength={5000} required defaultValue={String(draft.content ?? "")} /></label>
        <label>Review/expiry date<input name="expiresOn" type="date" defaultValue={String(draft.expiresOn ?? "")} /></label>
        <p>Clinical material is stored as an encrypted draft only. No review, approval or publication action exists in this workflow.</p>
      </>}
      <button className="button button-primary" disabled={busy || !centreId}>{busy ? "Saving…" : selected ? "Save new draft version" : "Save encrypted draft"}</button>
      {selected && <button type="button" className="button button-secondary" disabled={busy} onClick={resetDraft}>Cancel edit</button>}
    </form>}
    {records.length > 0 && <div className="table-scroll"><table className="admin-table"><thead><tr><th>Draft</th><th>Centre</th><th>State</th><th>Version</th><th>Updated</th>{canManage && <th>Action</th>}</tr></thead><tbody>{records.map((row) => <tr key={row.id}><td>{kind === "PROVIDER_POLICY" ? String(row.privateData.displayName ?? channel) : String(row.privateData.title ?? "Knowledge draft")}{row.channel && <small className="appointment-sub">{row.channel} policy</small>}</td><td>{centres.find((item) => item.id === row.centreId)?.name ?? "Authorized centre"}</td><td>{row.status} · NOT ACTIVE</td><td>{row.versionNumber}</td><td>{new Date(row.updatedAt).toLocaleString()}</td>{canManage && <td><button type="button" className="button button-secondary" onClick={() => edit(row)}>Edit draft</button></td>}</tr>)}</tbody></table></div>}
    {kind === "KNOWLEDGE" && records.some((row) => row.privateData.category === "CLINICAL") && <p role="note">Clinical draft content is not approved and cannot be provided to users or used by an assistant.</p>}
    <p className="public-catalogue-note">Provider connection: NOT CONFIGURED · External delivery: DISABLED · AI knowledge publication: DISABLED</p>
  </section>;
}
