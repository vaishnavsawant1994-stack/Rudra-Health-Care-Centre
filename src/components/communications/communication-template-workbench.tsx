"use client";

import { useCallback, useEffect, useState } from "react";

type Centre = { id: string; name: string; code: string };
type Template = { id: string; centreId: string; purpose: "OPERATIONAL" | "MARKETING"; channel: "PHONE" | "EMAIL" | "WHATSAPP"; status: "DRAFT" | "ACTIVE" | "ARCHIVED"; versionNumber: number; name: string; body: string; createdAt: string; updatedAt: string };
type Event = { id: string; eventType: string; name: string; body: string; status: string; versionNumber: number; reason?: string; actor: string; recordedAt: string };

export function CommunicationTemplateWorkbench() {
  const [centres, setCentres] = useState<Centre[]>([]);
  const [centreId, setCentreId] = useState("");
  const [templates, setTemplates] = useState<Template[]>([]);
  const [selected, setSelected] = useState<Template | null>(null);
  const [history, setHistory] = useState<Event[]>([]);
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const [purpose, setPurpose] = useState<"OPERATIONAL" | "MARKETING">("OPERATIONAL");
  const [channel, setChannel] = useState<"PHONE" | "EMAIL" | "WHATSAPP">("EMAIL");
  const [reason, setReason] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [message, setMessage] = useState("Loading authorized centres…");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/communications/templates/centres", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json() as { centres?: Centre[] } })).then(({ response, body: result }) => {
      if (!active) return;
      const available = response.ok ? result.centres ?? [] : [];
      setCentres(available);
      setCentreId(available[0]?.id ?? "");
      setMessage(available.length ? "" : "No centre is available for template management in this workspace.");
    }).catch(() => { if (active) setMessage("Template management is unavailable."); });
    return () => { active = false; };
  }, []);

  const load = useCallback(async () => {
    if (!centreId) return;
    try {
      const query = new URLSearchParams({ centreId, status: statusFilter });
      const response = await fetch(`/api/communications/templates?${query}`, { cache: "no-store" });
      const result = await response.json() as { templates?: Template[]; error?: string };
      if (!response.ok) throw new Error(result.error ?? "unavailable");
      setTemplates(result.templates ?? []);
      setSelected((current) => current && (result.templates ?? []).some((item) => item.id === current.id) ? current : null);
      setMessage(result.templates?.length ? "" : "No templates match this centre and status.");
    } catch { setTemplates([]); setMessage("Templates could not be loaded in this centre. Check your permissions."); }
  }, [centreId, statusFilter]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  async function open(id: string) {
    try {
      const response = await fetch(`/api/communications/templates/${id}`, { cache: "no-store" });
      const result = await response.json() as { template?: Template; history?: Event[]; error?: string };
      if (!response.ok || !result.template) throw new Error(result.error ?? "unavailable");
      setSelected(result.template); setHistory(result.history ?? []); setName(result.template.name); setBody(result.template.body); setReason(""); setMessage("");
    } catch { setMessage("Template details are unavailable in your authorized scope."); }
  }

  async function create(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      const response = await fetch("/api/communications/templates", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ centreId, purpose, channel, name, body, idempotencyKey: crypto.randomUUID() }) });
      const result = await response.json() as { template?: Template; error?: string };
      if (!response.ok || !result.template) throw new Error(result.error ?? "unavailable");
      setName(""); setBody(""); await load(); await open(result.template.id); setMessage("Draft saved. It has not been sent.");
    } catch (error) { setMessage(error instanceof Error && error.message === "invalid_template" ? "Use a supported template variable and check the required fields." : "Template draft could not be saved."); }
    finally { setBusy(false); }
  }

  async function act(action: "UPDATE" | "ACTIVATE" | "ARCHIVE") {
    if (!selected) return;
    setBusy(true);
    try {
      const payload = action === "UPDATE" ? { action, expectedVersion: selected.versionNumber, name, body } : { action, expectedVersion: selected.versionNumber, reason };
      const response = await fetch(`/api/communications/templates/${selected.id}`, { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": crypto.randomUUID() }, body: JSON.stringify(payload) });
      const result = await response.json() as { template?: Template; error?: string };
      if (!response.ok) throw new Error(result.error ?? "unavailable");
      await load(); await open(selected.id); setMessage(action === "ACTIVATE" ? "Template activated for internal use. Delivery remains disabled." : action === "ARCHIVE" ? "Template archived. Delivery remains disabled." : "Draft updated.");
    } catch (error) { setMessage(error instanceof Error && error.message === "version_conflict" ? "This template changed elsewhere. Reload and review the latest version." : "Template action could not be completed."); }
    finally { setBusy(false); }
  }

  return <section className="admin-card">
    <div className="task-toolbar"><div><h2>Communication templates</h2><p>Encrypted staff-managed copy for future workflows. Activation is internal approval only. Sending, scheduling and provider delivery are disabled.</p></div></div>
    <div className="appointment-filters"><label>Centre<select value={centreId} onChange={(event) => { setCentreId(event.target.value); setSelected(null); }}><option value="">Select centre</option>{centres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name} ({centre.code})</option>)}</select></label><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="ALL">All templates</option><option value="DRAFT">Drafts</option><option value="ACTIVE">Active</option><option value="ARCHIVED">Archived</option></select></label></div>
    {message && <p role="status">{message}</p>}
    <form className="admin-form task-form" onSubmit={create}><h3>Create draft template</h3><p>Do not include patient details or clinical results. Supported merge fields: <code>{"{{firstName}}"}</code>, <code>{"{{leadNumber}}"}</code>, <code>{"{{serviceName}}"}</code>, <code>{"{{centreName}}"}</code>, <code>{"{{appointmentDate}}"}</code>.</p><label>Centre<select required value={centreId} onChange={(event) => setCentreId(event.target.value)}><option value="">Select centre</option>{centres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name}</option>)}</select></label><label>Purpose<select value={purpose} onChange={(event) => setPurpose(event.target.value as typeof purpose)}><option value="OPERATIONAL">Operational</option><option value="MARKETING">Marketing</option></select></label><label>Channel<select value={channel} onChange={(event) => setChannel(event.target.value as typeof channel)}><option value="PHONE">Phone script</option><option value="EMAIL">Email</option><option value="WHATSAPP">WhatsApp</option></select></label><label>Template name<input required minLength={2} maxLength={80} value={name} onChange={(event) => setName(event.target.value)} /></label><label>Message copy<textarea required maxLength={2000} value={body} onChange={(event) => setBody(event.target.value)} /></label><button className="button button-primary" disabled={busy || !centreId}>Save draft</button></form>
    {templates.length > 0 && <div className="table-scroll"><table className="admin-table"><thead><tr><th>Name</th><th>Purpose</th><th>Channel</th><th>Status</th><th>Version</th><th>Action</th></tr></thead><tbody>{templates.map((template) => <tr key={template.id}><td>{template.name}</td><td>{template.purpose}</td><td>{template.channel}</td><td>{template.status}</td><td>{template.versionNumber}</td><td><button type="button" className="button button-secondary" onClick={() => void open(template.id)}>Details and history</button></td></tr>)}</tbody></table></div>}
    {selected && <section className="admin-card" aria-label="Template details"><h3>{selected.name} · {selected.status} · version {selected.versionNumber}</h3><p>{selected.purpose} · {selected.channel} · delivery disabled</p>{selected.status === "DRAFT" ? <><label>Name<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label><label>Message copy<textarea value={body} maxLength={2000} onChange={(event) => setBody(event.target.value)} /></label><button type="button" className="button button-secondary" disabled={busy} onClick={() => void act("UPDATE")}>Save draft changes</button><label>Activation reason<input value={reason} maxLength={240} onChange={(event) => setReason(event.target.value)} /></label><button type="button" className="button button-primary" disabled={busy || reason.trim().length < 3} onClick={() => void act("ACTIVATE")}>Activate for internal use</button></> : selected.status === "ACTIVE" ? <><label>Archive reason<input value={reason} maxLength={240} onChange={(event) => setReason(event.target.value)} /></label><button type="button" className="button button-secondary" disabled={busy || reason.trim().length < 3} onClick={() => void act("ARCHIVE")}>Archive template</button></> : null}<h4>Version and decision history</h4><ol>{history.map((entry) => <li key={entry.id}>{entry.eventType} · v{entry.versionNumber} · {entry.status} · {entry.actor} · {new Date(entry.recordedAt).toLocaleString()}{entry.reason ? ` · ${entry.reason}` : ""}</li>)}</ol><button type="button" className="button button-secondary" onClick={() => setSelected(null)}>Close</button></section>}
  </section>;
}
