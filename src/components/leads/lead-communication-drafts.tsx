"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type Draft = { id: string; purpose: string; channel: string; status: string; createdAt: string; updatedAt: string; body: string; templateId: string | null; templateVersion: number | null };
type Template = { id: string; purpose: "OPERATIONAL" | "MARKETING"; channel: string; version: number; name: string };
type LeadConsent = { contactPermission: string; marketingConsent: string; status: string; preferredChannel: string };

export function LeadCommunicationDrafts({ leadId, lead, canUseTemplates }: { leadId: string; lead: LeadConsent; canUseTemplates: boolean }) {
  const [drafts, setDrafts] = useState<Draft[]>([]); const [templates, setTemplates] = useState<Template[]>([]); const [templateId, setTemplateId] = useState(""); const [purpose, setPurpose] = useState("OPERATIONAL"); const [message, setMessage] = useState("Loading drafts…"); const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    try { const response = await fetch(`/api/leads/${leadId}/communications`, { cache: "no-store" }); const data = await response.json() as { drafts?: Draft[] }; if (!response.ok) { setDrafts([]); setMessage("Draft access is unavailable in your authorized scope."); return; } setDrafts(data.drafts ?? []); setMessage(""); }
    catch { setDrafts([]); setMessage("Draft service is unavailable."); }
  }, [leadId]);
  useEffect(() => { const timer = window.setTimeout(() => void refresh(), 0); return () => window.clearTimeout(timer); }, [refresh]);
  useEffect(() => {
    if (!canUseTemplates) return;
    let active = true;
    void fetch(`/api/leads/${encodeURIComponent(leadId)}/communications?view=templates`, { cache: "no-store" }).then(async (response) => {
      const result = await response.json() as { templates?: Template[] };
      if (active) setTemplates(response.ok ? result.templates ?? [] : []);
    }).catch(() => { if (active) setTemplates([]); });
    return () => { active = false; };
  }, [canUseTemplates, leadId]);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const formData = new FormData(form); setBusy(true); setMessage("");
    try {
      const template = templates.find((item) => item.id === templateId);
      const response = await fetch(`/api/leads/${leadId}/communications`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: crypto.randomUUID(), purpose, channel: lead.preferredChannel, ...(template ? { templateId: template.id, templateVersion: template.version } : { body: String(formData.get("body") ?? "") }) }) });
      const result = await response.json() as { error?: string; draft?: { templateVersion: number | null } };
      if (!response.ok) { setMessage(result.error === "contact_permission_required" ? "Draft creation is blocked until operational contact permission is verified." : result.error === "marketing_consent_required" ? "Marketing consent is not recorded as granted." : result.error === "preferred_channel_mismatch" ? "Preferred channel changed. Refresh this page before drafting." : result.error === "template_data_unavailable" ? "This template needs information that is not available for this lead. Review or update it before use." : result.error === "template_unavailable" ? "The selected template changed or is no longer active. Refresh the page and choose an active version." : "Draft could not be saved in the current authorization scope."); return; }
      form.reset(); setTemplateId(""); await refresh(); setMessage(template ? `Encrypted draft created from template version ${result.draft?.templateVersion}. Review it before any future contact. Nothing was sent.` : "Encrypted draft saved. Nothing was sent.");
    } catch { setMessage("Draft service is unavailable. No delivery was attempted."); }
    finally { setBusy(false); }
  }
  async function discard(draft: Draft) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/leads/${leadId}/communications`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ draftId: draft.id, action: "CANCEL", expectedUpdatedAt: draft.updatedAt }) });
      const result = await response.json() as { error?: string };
      if (!response.ok) { setMessage(result.error === "draft_conflict" ? "This draft changed. Refresh before trying again." : "Draft could not be discarded in the current authorization scope."); return; }
      setMessage("Draft discarded. Nothing was sent."); await refresh();
    } catch { setMessage("Draft service is unavailable. No delivery was attempted."); }
    finally { setBusy(false); }
  }
  const allowed = lead.contactPermission === "AUTHORIZED" && lead.status !== "DO_NOT_CONTACT" && lead.preferredChannel !== "NONE";
  return <section className="admin-card"><h3>Communication drafts</h3><p>Staff-only encrypted drafts. This workflow never sends messages or records delivery.</p>
    {allowed ? <form className="admin-form" onSubmit={(event) => void create(event)}>
      <label>Draft purpose<select value={purpose} onChange={(event) => { setPurpose(event.target.value); setTemplateId(""); }}><option value="OPERATIONAL">Operational follow-up</option>{lead.marketingConsent === "GRANTED" && <option value="MARKETING">Marketing</option>}</select></label>
      <label>Preferred channel<input readOnly value={lead.preferredChannel.replaceAll("_", " ")} /></label>
      {canUseTemplates && <label>Active template<select value={templateId} onChange={(event) => { const selected = templates.find((item) => item.id === event.target.value); setTemplateId(event.target.value); if (selected) setPurpose(selected.purpose); }}><option value="">Write a draft manually</option>{templates.filter((item) => item.purpose === purpose).map((item) => <option key={item.id} value={item.id}>{item.name} · v{item.version}</option>)}</select></label>}
      {templateId ? <p>The selected template will be rendered from authorized lead and centre data on save. You can review the encrypted draft below; no message will be sent.</p> : <label>Draft text<textarea name="body" maxLength={2000} required /></label>}<small>Do not include health information. Marketing drafts require separately recorded marketing consent. Templates may require a linked confirmed appointment for appointment-date fields.</small>
      <button className="button button-secondary" disabled={busy}>{busy ? "Saving…" : "Save encrypted draft"}</button>
    </form> : <p>Draft creation is unavailable until contact authorization and a preferred channel are recorded. Do Not Contact status blocks outreach.</p>}
    {message && <p role="status">{message} <button type="button" className="text-button" onClick={() => void refresh()}>Refresh drafts</button></p>}
    <ol>{drafts.map((draft) => <li key={draft.id}><strong>{draft.purpose} · {draft.channel} · {draft.status}{draft.templateVersion ? ` · template v${draft.templateVersion}` : ""}</strong><p>{draft.body}</p><small>{new Date(draft.createdAt).toLocaleString()}</small>{draft.status === "DRAFT" && <button type="button" className="text-button" disabled={busy} onClick={() => void discard(draft)}>Discard draft</button>}</li>)}</ol>
  </section>;
}
