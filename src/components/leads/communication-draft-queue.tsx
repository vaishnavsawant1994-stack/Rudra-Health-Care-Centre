"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { LeadFollowups } from "@/components/leads/lead-workbench";

type Centre = { id: string; name: string; code: string };
type Enquiry = { id: string; reference: string; status: string; centreId: string; createdAt: string };
type Draft = { id: string; leadId: string; leadNumber: string; purpose: string; channel: string; status: string; createdAt: string; updatedAt: string; creator: string; canCancel?: boolean };
type View = "enquiries" | "drafts" | "followups";

export function UnifiedCommunicationInbox({ canReadFollowups = false }: { canReadFollowups?: boolean } = {}) {
  const [centres, setCentres] = useState<Centre[]>([]);
  const [centreId, setCentreId] = useState("");
  const [view, setView] = useState<View>("enquiries");
  const [status, setStatus] = useState("PENDING_REVIEW");
  const [purpose, setPurpose] = useState("ALL");
  const [channel, setChannel] = useState("ALL");
  const [enquiries, setEnquiries] = useState<Enquiry[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("Loading authorized centres…");
  const latestRequest = useRef(0);

  useEffect(() => {
    let live = true;
    void fetch("/api/leads/centres", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json() as { centres?: Centre[] } })).then(({ response, body }) => {
      if (!live) return;
      const list = response.ok ? body.centres ?? [] : [];
      setCentres(list);
      setCentreId((current) => list.some((centre) => centre.id === current) ? current : list[0]?.id ?? "");
      setMessage(list.length ? "" : "No authorized centre is available for communication review.");
    }).catch(() => { if (live) setMessage("Communications inbox is unavailable."); });
    return () => { live = false; };
  }, []);

  const load = useCallback(async (requestedPage = 1) => {
    if (view === "followups") { setBusy(false); setMessage(""); return; }
    if (!centreId) return;
    const requestId = ++latestRequest.current;
    setBusy(true);
    setMessage(view === "enquiries" ? "Loading website enquiry queue…" : "Loading internal communication drafts…");
    try {
      const query = new URLSearchParams({ centreId, page: String(requestedPage) });
      if (view === "enquiries") { query.set("status", status); query.set("summary", "true"); }
      else { query.set("purpose", purpose); query.set("channel", channel); }
      const endpoint = view === "enquiries" ? "/api/public/enquiries" : "/api/communications/drafts";
      const response = await fetch(`${endpoint}?${query}`, { cache: "no-store" });
      const body = await response.json() as { enquiries?: Enquiry[]; drafts?: Draft[]; hasMore?: boolean; error?: string };
      if (!response.ok) throw new Error(body.error ?? "unavailable");
      if (requestId !== latestRequest.current) return;
      setEnquiries(body.enquiries ?? []);
      setDrafts(body.drafts ?? []);
      setPage(requestedPage);
      setHasMore(body.hasMore === true);
      const count = view === "enquiries" ? body.enquiries?.length : body.drafts?.length;
      setMessage(count ? "" : view === "enquiries" ? "No website enquiries match this status." : "No internal drafts match these filters.");
    } catch {
      if (requestId !== latestRequest.current) return;
      setEnquiries([]); setDrafts([]); setHasMore(false);
      setMessage(view === "enquiries" ? "Website enquiry queue could not be loaded in your authorized scope." : "Draft queue could not be loaded in your authorized scope.");
    } finally { if (requestId === latestRequest.current) setBusy(false); }
  }, [centreId, channel, purpose, status, view]);

  async function cancelDraft(draft: Draft) {
    if (draft.status !== "DRAFT" || !draft.canCancel || !window.confirm("Cancel this unsent draft? It will remain in history and will not be sent.")) return;
    setBusy(true); setMessage("Cancelling unsent draft…");
    try {
      const response = await fetch(`/api/leads/${encodeURIComponent(draft.leadId)}/communications`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftId: draft.id, action: "CANCEL", expectedUpdatedAt: draft.updatedAt }),
      });
      const body = await response.json() as { draft?: { status?: string }; error?: string };
      if (!response.ok || body.draft?.status !== "CANCELLED") throw new Error(body.error ?? "cancel_failed");
      await load(page);
      setMessage("Draft cancelled and retained in history. No message was sent.");
    } catch (error) {
      setMessage(error instanceof Error && error.message === "draft_conflict" ? "This draft changed elsewhere. Refresh before trying again." : "Draft cancellation was not confirmed. Refresh to check its saved status.");
    } finally { setBusy(false); }
  }

  useEffect(() => { void Promise.resolve().then(() => load(1)); }, [load]);

  return <section className="admin-card">
    <div className="task-toolbar"><div><h2>Communications inbox</h2><p>Website enquiries and staff-only drafts share one centre-scoped workspace. Enquiry rows show reference metadata only; open the protected enquiry queue for authorized details. Drafts are never sent from here.</p></div></div>
    <div className="task-toolbar" role="tablist" aria-label="Communications inbox views">
      <button type="button" role="tab" aria-selected={view === "enquiries"} className={view === "enquiries" ? "button button-primary" : "button button-secondary"} onClick={() => { setView("enquiries"); setPage(1); }}>Website enquiries</button>
      <button type="button" role="tab" aria-selected={view === "drafts"} className={view === "drafts" ? "button button-primary" : "button button-secondary"} onClick={() => { setView("drafts"); setPage(1); }}>Unsent drafts</button>
      {canReadFollowups && <button type="button" role="tab" aria-selected={view === "followups"} className={view === "followups" ? "button button-primary" : "button button-secondary"} onClick={() => { setView("followups"); setPage(1); }}>CRM follow-ups</button>}
    </div>
    {view === "followups" ? <div role="tabpanel" aria-label="CRM follow-ups"><LeadFollowups /></div> : <>
    <div className="appointment-filters" role="tabpanel" aria-label={view === "enquiries" ? "Website enquiries" : "Unsent drafts"}>
      <label>Centre<select value={centreId} onChange={(event) => { setCentreId(event.target.value); setPage(1); }}><option value="">Select authorized centre</option>{centres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name} ({centre.code})</option>)}</select></label>
      {view === "enquiries" ? <label>Queue status<select value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }}><option value="PENDING_REVIEW">Pending review</option><option value="CONVERTED_TO_LEAD">Converted to lead</option><option value="CONVERTED_TO_RELATIONSHIP">Converted to relationship</option><option value="DISMISSED">Dismissed</option></select></label> : <><label>Purpose<select value={purpose} onChange={(event) => { setPurpose(event.target.value); setPage(1); }}><option value="ALL">All purposes</option><option value="OPERATIONAL">Operational</option><option value="MARKETING">Marketing</option></select></label><label>Channel<select value={channel} onChange={(event) => { setChannel(event.target.value); setPage(1); }}><option value="ALL">All channels</option><option value="PHONE">Phone</option><option value="EMAIL">Email</option><option value="WHATSAPP">WhatsApp</option></select></label></>}
      <button className="button button-secondary" type="button" disabled={!centreId || busy} onClick={() => void load(1)}>Refresh</button>
    </div>
    {message && <p role="status">{message}</p>}
    {view === "enquiries" && enquiries.length > 0 && <><div className="table-scroll"><table className="admin-table"><thead><tr><th>Reference</th><th>Status</th><th>Received</th><th>Review</th></tr></thead><tbody>{enquiries.map((enquiry) => <tr key={enquiry.id}><td>{enquiry.reference}</td><td>{enquiry.status}</td><td>{new Date(enquiry.createdAt).toLocaleString()}</td><td><Link href="/leads/public-enquiries">Open protected review queue</Link></td></tr>)}</tbody></table></div><nav className="task-pagination" aria-label="Website enquiry pages"><button className="button button-secondary" type="button" disabled={page <= 1 || busy} onClick={() => void load(page - 1)}>Previous</button><span>Page {page}</span><button className="button button-secondary" type="button" disabled={!hasMore || busy} onClick={() => void load(page + 1)}>Next</button></nav></>}
    {view === "drafts" && drafts.length > 0 && <><div className="table-scroll"><table className="admin-table"><thead><tr><th>Lead</th><th>Purpose</th><th>Channel</th><th>Status</th><th>Created by</th><th>Created</th><th>Actions</th></tr></thead><tbody>{drafts.map((draft) => <tr key={draft.id}><td>{draft.leadNumber}</td><td>{draft.purpose}</td><td>{draft.channel}</td><td>{draft.status} · NOT SENT</td><td>{draft.creator}</td><td>{new Date(draft.createdAt).toLocaleString()}</td><td><Link href={`/leads/${draft.leadId}`}>Open authorized lead</Link>{draft.status === "DRAFT" && draft.canCancel && <button className="button button-secondary" type="button" disabled={busy} onClick={() => void cancelDraft(draft)}>Cancel unsent draft</button>}</td></tr>)}</tbody></table></div><nav className="task-pagination" aria-label="Communication draft pages"><button className="button button-secondary" type="button" disabled={page <= 1 || busy} onClick={() => void load(page - 1)}>Previous</button><span>Page {page}</span><button className="button button-secondary" type="button" disabled={!hasMore || busy} onClick={() => void load(page + 1)}>Next</button></nav></>}
    </>}
    <p className="public-catalogue-note">No external email, SMS, WhatsApp or voice provider is connected. This inbox does not mark a contact as reached and does not send or schedule messages.</p>
  </section>;
}
