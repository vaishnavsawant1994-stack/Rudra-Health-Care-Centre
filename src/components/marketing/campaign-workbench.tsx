"use client";

import { useCallback, useEffect, useState } from "react";

type Centre = { id: string; name: string; code: string };
type Campaign = { id: string; centreId: string; campaignCode: string; name: string; description: string | null; channel: string; status: string; startsOn: string | null; endsOn: string | null; versionNumber: number; attributedLeadCount: number; convertedLeadCount: number; conversionRatePercent: number | null; appointmentCount: number; activeAppointmentCount: number; confirmedAppointmentCount: number };
type CampaignEvent = { id: string; eventType: string; status?: string; reason?: string; recordedAt: string; versionNumber?: number };
type CampaignWindow = { from: string | null; to: string | null; basis: "LEAD_CREATED_COHORT" | "ALL_RECORDED_LEADS" };

export function CampaignWorkbench({ managedCentreIds = [] }: { managedCentreIds?: string[] }) {
  const [centres, setCentres] = useState<Centre[]>([]);
  const [centreId, setCentreId] = useState("");
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [appliedFrom, setAppliedFrom] = useState("");
  const [appliedTo, setAppliedTo] = useState("");
  const [windowSummary, setWindowSummary] = useState<CampaignWindow | null>(null);
  const [message, setMessage] = useState("Loading authorized centres…");
  const [busy, setBusy] = useState(false);
  const [history, setHistory] = useState<{ campaignId: string; events: CampaignEvent[] } | null>(null);
  const [editing, setEditing] = useState<Campaign | null>(null);
  const canManage = managedCentreIds.includes("*") || managedCentreIds.includes(centreId);
  const load = useCallback(async (id: string, selectedFrom = appliedFrom, selectedTo = appliedTo) => {
    if (!id) return;
    const params = new URLSearchParams({ centreId: id });
    if (selectedFrom && selectedTo) { params.set("from", selectedFrom); params.set("to", selectedTo); }
    const response = await fetch(`/api/marketing/campaigns?${params}`, { cache: "no-store" });
    const body = await response.json() as { campaigns?: Campaign[]; attributionWindow?: CampaignWindow; error?: string };
    if (!response.ok) throw new Error(body.error ?? "unavailable");
    setCampaigns(body.campaigns ?? []);
    setWindowSummary(body.attributionWindow ?? null);
    setMessage(body.campaigns?.length ? "" : "No internal campaigns recorded for this centre.");
  }, [appliedFrom, appliedTo]);

  useEffect(() => {
    let live = true;
    void fetch("/api/marketing/centres", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json() as { centres?: Centre[] } })).then(async ({ response, body }) => {
      if (!live) return;
      const rows = response.ok ? body.centres ?? [] : [];
      setCentres(rows);
      setCentreId(rows[0]?.id ?? "");
      if (!rows.length) setMessage("No authorized centre is available for campaign management.");
      else try { await load(rows[0].id); } catch { if (live) setMessage("Campaign records could not be loaded."); }
    }).catch(() => { if (live) setMessage("Campaign workspace is unavailable."); });
    return () => { live = false; };
  }, [load]);

  async function refresh() { try { await load(centreId); } catch { setMessage("Campaign records could not be refreshed."); } }
  async function applyWindow(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (Boolean(from) !== Boolean(to)) { setMessage("Enter both dates, or clear both to show all recorded leads."); return; }
    if (from && to && from > to) { setMessage("The start date must be on or before the end date."); return; }
    if (from && to && new Date(`${to}T00:00:00.000Z`).getTime() - new Date(`${from}T00:00:00.000Z`).getTime() + 86_400_000 > 366 * 86_400_000) { setMessage("Choose a date range of no more than 366 days."); return; }
    setMessage("Loading campaign attribution for the selected period…");
    setAppliedFrom(from);
    setAppliedTo(to);
  }
  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; setBusy(true); setMessage("");
    const data = new FormData(form);
    const body = { centreId, campaignCode: String(data.get("campaignCode")), name: String(data.get("name")), description: String(data.get("description") || "") || null, channel: String(data.get("channel")), startsOn: String(data.get("startsOn") || "") || null, endsOn: String(data.get("endsOn") || "") || null, idempotencyKey: crypto.randomUUID() };
    try {
      const response = await fetch("/api/marketing/campaigns", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "unavailable");
      form.reset(); await refresh(); setMessage("Campaign saved as an internal draft. No publication, messaging or advertising spend occurred.");
    } catch { setMessage("Campaign could not be saved. Check the fields and your centre access."); }
    finally { setBusy(false); }
  }
  async function changeStatus(campaign: Campaign, action: "ACTIVATE" | "COMPLETE" | "CANCEL") {
    const reason = window.prompt(action === "ACTIVATE" ? "Why is this internal campaign ready to track?" : "Record a reason for this status change.");
    if (!reason || reason.trim().length < 3) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/marketing/campaigns/${encodeURIComponent(campaign.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, expectedVersion: campaign.versionNumber, reason }) });
      if (!response.ok) throw new Error("unavailable"); await refresh();
    } catch { setMessage("Campaign status was not changed. Refresh and try again if the record is still current."); }
    finally { setBusy(false); }
  }
  async function showHistory(campaign: Campaign) {
    try { const response = await fetch(`/api/marketing/campaigns/${encodeURIComponent(campaign.id)}`, { cache: "no-store" }); const body = await response.json() as { history?: CampaignEvent[] }; if (!response.ok) throw new Error("unavailable"); setHistory({ campaignId: campaign.id, events: body.history ?? [] }); }
    catch { setMessage("Campaign history is unavailable in your current access scope."); }
  }
  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!editing) return;
    const form = event.currentTarget; const data = new FormData(form); setBusy(true); setMessage("");
    const body = { action: "UPDATE", expectedVersion: editing.versionNumber, reason: String(data.get("reason")), campaignCode: String(data.get("campaignCode")), name: String(data.get("name")), description: String(data.get("description") || "") || null, channel: String(data.get("channel")), startsOn: String(data.get("startsOn") || "") || null, endsOn: String(data.get("endsOn") || "") || null };
    try { const response = await fetch(`/api/marketing/campaigns/${encodeURIComponent(editing.id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); if (!response.ok) throw new Error("unavailable"); setEditing(null); await refresh(); setMessage("Campaign details updated with an audit reason."); }
    catch { setMessage("Campaign was not updated. Refresh to check for a concurrent change."); }
    finally { setBusy(false); }
  }

  return <section className="admin-card">
    <div className="task-toolbar"><div><h2>Internal campaign attribution</h2><p>Track centre campaigns and connect them to CRM enquiries. This workspace does not publish content, send communications or spend advertising funds.</p></div>{centres.length > 0 && <label>Centre<select value={centreId} onChange={(event) => { setCentreId(event.target.value); void load(event.target.value).catch(() => setMessage("Campaign records could not be loaded.")); }}>{centres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name} ({centre.code})</option>)}</select></label>}</div>
    {!canManage && <p className="muted">Read-only campaign attribution access.</p>}
    {message && <p role="status">{message}</p>}
    {centreId && <form className="admin-form" onSubmit={(event) => void applyWindow(event)} aria-label="Campaign attribution date filter"><h3>Attribution period</h3><label>Lead created from<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label><label>Lead created through<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label><button className="button button-secondary" disabled={busy}>Apply period</button><p className="muted">{windowSummary?.basis === "LEAD_CREATED_COHORT" ? `Counts leads created ${windowSummary.from} through ${windowSummary.to}; conversions recorded later for those leads are included.` : "Showing all recorded attributed leads and their recorded conversions."}</p></form>}
    {canManage && centreId && <form className="admin-form" onSubmit={(event) => void create(event)}><h3>Create campaign record</h3><label>Campaign code<input name="campaignCode" required maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" /></label><label>Name<input name="name" required minLength={2} maxLength={100} /></label><label>Internal description<textarea name="description" maxLength={1000} /></label><label>Channel<select name="channel"><option value="WEBSITE">Website</option><option value="REFERRAL">Referral</option><option value="PHONE">Phone</option><option value="WALK_IN">Walk-in</option><option value="PRINT">Print</option><option value="SOCIAL">Social</option><option value="OTHER">Other</option></select></label><label>Start date<input name="startsOn" type="date" /></label><label>End date<input name="endsOn" type="date" /></label><button className="button button-primary" disabled={busy}>{busy ? "Saving…" : "Save draft"}</button></form>}
    <div className="table-scroll"><table className="admin-table"><thead><tr><th>Code</th><th>Name</th><th>Channel</th><th>Status</th><th>Dates</th><th>Attributed leads</th><th>Converted leads</th><th>Lead conversion</th><th>Bookings</th><th>Active bookings</th><th>Confirmed bookings</th><th>Actions</th></tr></thead><tbody>{campaigns.map((campaign) => <tr key={campaign.id}><td>{campaign.campaignCode}</td><td>{campaign.name}</td><td>{campaign.channel}</td><td>{campaign.status}</td><td>{campaign.startsOn ?? "—"} – {campaign.endsOn ?? "—"}</td><td>{campaign.attributedLeadCount}</td><td>{campaign.convertedLeadCount}</td><td>{campaign.conversionRatePercent === null ? "—" : `${campaign.conversionRatePercent.toFixed(1)}%`}</td><td>{campaign.appointmentCount}</td><td>{campaign.activeAppointmentCount}</td><td>{campaign.confirmedAppointmentCount}</td><td><button className="button button-secondary" onClick={() => void showHistory(campaign)}>History</button> {canManage && campaign.status !== "COMPLETED" && campaign.status !== "CANCELLED" && <button className="button button-secondary" onClick={() => setEditing(campaign)}>Edit</button>} {canManage && campaign.status === "DRAFT" && <button className="button button-secondary" disabled={busy} onClick={() => void changeStatus(campaign, "ACTIVATE")}>Activate tracking</button>}{canManage && campaign.status === "ACTIVE" && <><button className="button button-secondary" disabled={busy} onClick={() => void changeStatus(campaign, "COMPLETE")}>Complete</button> <button className="button button-secondary" disabled={busy} onClick={() => void changeStatus(campaign, "CANCEL")}>Cancel</button></>}</td></tr>)}</tbody></table></div>
    <p className="muted">Appointment counts link recorded bookings to attributed CRM leads. Active excludes cancelled and no-show bookings; confirmed includes CONFIRMED, ASSIGNED and RESCHEDULED states. Lead conversion is recorded patient conversion divided by attributed leads. These measures are not revenue or clinical-service completion.</p>
    {canManage && editing && <form className="admin-form" onSubmit={(event) => void saveEdit(event)}><h3>Edit campaign {editing.campaignCode}</h3><label>Campaign code<input name="campaignCode" defaultValue={editing.campaignCode} required maxLength={32} pattern="[A-Za-z0-9][A-Za-z0-9_-]*" /></label><label>Name<input name="name" defaultValue={editing.name} required minLength={2} maxLength={100} /></label><label>Internal description<textarea name="description" defaultValue={editing.description ?? ""} maxLength={1000} /></label><label>Channel<select name="channel" defaultValue={editing.channel}>{["WEBSITE", "REFERRAL", "PHONE", "WALK_IN", "PRINT", "SOCIAL", "OTHER"].map((channel) => <option key={channel}>{channel}</option>)}</select></label><label>Start date<input name="startsOn" type="date" defaultValue={editing.startsOn ?? ""} /></label><label>End date<input name="endsOn" type="date" defaultValue={editing.endsOn ?? ""} /></label><label>Change reason<input name="reason" required minLength={3} maxLength={240} /></label><button className="button button-primary" disabled={busy}>Save campaign</button><button className="button button-secondary" type="button" onClick={() => setEditing(null)}>Close</button></form>}
    {history && <section aria-label="Campaign history"><h3>Campaign history</h3><button className="button button-secondary" onClick={() => setHistory(null)}>Close history</button>{history.events.length ? <ol>{history.events.map((event) => <li key={event.id}>{event.eventType} · {event.status ?? "updated"} · {new Date(event.recordedAt).toLocaleString()}{event.reason ? ` · ${event.reason}` : ""}</li>)}</ol> : <p>No campaign events recorded.</p>}</section>}
    <p className="muted">Campaign names and descriptions are encrypted at rest. Events are append-only. CRM attribution remains centre-scoped.</p>
  </section>;
}
