"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, useContext, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { clearPublicBookingIdempotencyKey, getPublicBookingIdempotencyKey } from "@/lib/public-booking-idempotency";

type Centre = { id: string; code: string; name: string };
type Service = { id: string; centreId: string; serviceType: "TEST" | "PACKAGE"; serviceCode: string; version: number; displayName: string; priceAmount: string; currency: string };
type BookingDraft = {
  centreId: string; selected: Service[]; visitType: "CENTRE" | "HOME_COLLECTION"; homeCharge: "75" | "99" | "150";
  firstName: string; lastName: string; phone: string; email: string; preferredDate: string; preferredTimeWindow: string;
  addressLine1: string; addressLine2: string; city: string; state: string; postalCode: string; responsePermission: boolean;
};
type BookingState = { draft: BookingDraft; update: (value: Partial<BookingDraft>) => void; receipt: string | null; setReceipt: (value: string | null) => void; reset: () => void };
const emptyDraft: BookingDraft = { centreId: "", selected: [], visitType: "CENTRE", homeCharge: "75", firstName: "", lastName: "", phone: "", email: "", preferredDate: "", preferredTimeWindow: "", addressLine1: "", addressLine2: "", city: "", state: "", postalCode: "", responsePermission: false };
const BookingContext = createContext<BookingState | null>(null);

export function BookingDraftProvider({ children }: { children: ReactNode }) {
  const [draft, setDraft] = useState(emptyDraft);
  const [receipt, setReceipt] = useState<string | null>(null);
  const state = useMemo<BookingState>(() => ({ draft, update: (value) => setDraft((current) => ({ ...current, ...value })), receipt, setReceipt, reset: () => { setDraft(emptyDraft); setReceipt(null); } }), [draft, receipt]);
  return <BookingContext.Provider value={state}>{children}</BookingContext.Provider>;
}

function useBooking() {
  const value = useContext(BookingContext);
  if (!value) throw new Error("BookingDraftProvider is required");
  return value;
}

function Steps({ current }: { current: number }) {
  const labels = ["Select Tests / Package", "Patient Details", "Collection Method", "Location & Address", "Date & Time", "Review & Request", "Payment"];
  return <nav className="r-book-steps" aria-label="Booking request progress">{labels.map((label, index) => <div className={index + 1 < current ? "is-done" : index + 1 === current ? "is-current" : ""} key={label}><b>{index + 1}</b><span>{label}<small>{index + 1 < current ? "Completed" : index + 1 === current ? "Current step" : ""}</small></span></div>)}</nav>;
}

function PreviewBanner() { return <div className="r-demo-note"><b>Request for staff review</b><span>This submits an enquiry only. It does not confirm an appointment, reserve a collection slot, or take payment.</span></div>; }

export function RudraBookingFlow({ step }: { step: "select" | "review" | "payment" | "confirmation" }) {
  const router = useRouter();
  const { draft, update, receipt, setReceipt, reset } = useBooking();
  const [centres, setCentres] = useState<Centre[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [cataloguePage, setCataloguePage] = useState(1);
  const [catalogueHasMore, setCatalogueHasMore] = useState(false);
  const [catalogueSearch, setCatalogueSearch] = useState("");
  const [appliedCatalogueSearch, setAppliedCatalogueSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const selectedTotal = draft.selected.reduce((sum, item) => sum + Number(item.priceAmount), 0);
  const currency = draft.selected[0]?.currency ?? "INR";
  const formatter = new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: 2 });

  useEffect(() => {
    let active = true;
    void fetch("/api/public/centres", { cache: "no-store" }).then(async (r) => ({ ok: r.ok, body: await r.json() as { centres?: Centre[] } })).then((centreResult) => {
      if (!active) return;
      if (!centreResult.ok) throw new Error("Public booking information is unavailable.");
      setCentres(centreResult.body.centres ?? []);
      setLoading(false);
    }).catch(() => { if (active) { setMessage("Current centres or published catalogue are unavailable. Please try again later."); setLoading(false); } });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!draft.centreId) return;
    let active = true;
    const query = new URLSearchParams({ centreId: draft.centreId, page: "1", pageSize: "100", ...(appliedCatalogueSearch ? { q: appliedCatalogueSearch } : {}) });
    void fetch(`/api/public/catalogue?${query}`, { cache: "no-store" }).then(async (response) => ({ response, body: await response.json() as { items?: Service[]; hasMore?: boolean } })).then(({ response, body }) => {
      if (!active) return;
      if (!response.ok) throw new Error("catalogue_unavailable");
      setServices(body.items ?? []);
      setCatalogueHasMore(body.hasMore === true);
      setCataloguePage(1);
      setMessage("");
      setLoading(false);
    }).catch(() => { if (active) { setServices([]); setCatalogueHasMore(false); setMessage("The published catalogue is unavailable. Please try again later."); setLoading(false); } });
    return () => { active = false; };
  }, [appliedCatalogueSearch, draft.centreId]);

  async function loadMoreCatalogue() {
    if (!draft.centreId || !catalogueHasMore || loading) return;
    setLoading(true);
    const page = cataloguePage + 1;
    const query = new URLSearchParams({ centreId: draft.centreId, page: String(page), pageSize: "100", ...(appliedCatalogueSearch ? { q: appliedCatalogueSearch } : {}) });
    try {
      const response = await fetch(`/api/public/catalogue?${query}`, { cache: "no-store" });
      const body = await response.json() as { items?: Service[]; hasMore?: boolean };
      if (!response.ok) throw new Error("catalogue_unavailable");
      setServices((current) => [...current, ...(body.items ?? []).filter((item) => !current.some((loaded) => loaded.id === item.id))]);
      setCataloguePage(page);
      setCatalogueHasMore(body.hasMore === true);
    } catch { setMessage("More catalogue services could not be loaded. Your current selections are unchanged."); }
    finally { setLoading(false); }
  }

  const centreServices = services.filter((item) => item.centreId === draft.centreId);
  const selectedIds = new Set(draft.selected.map((item) => item.id));
  function selectService(id: string, checked: boolean) {
    const service = centreServices.find((item) => item.id === id);
    if (!service) return;
    update({ selected: checked ? [...draft.selected.filter((item) => item.id !== id), service] : draft.selected.filter((item) => item.id !== id) });
  }
  function goReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.selected.length) { setMessage("Select at least one currently published test or package."); return; }
    if (!draft.centreId) { setMessage("Select a centre accepting public requests."); return; }
    setMessage("");
    router.push("/book/review");
  }

  async function submitRequest() {
    if (busy) return;
    const selected = draft.selected;
    if (!draft.centreId || !draft.firstName.trim() || !draft.lastName.trim() || !draft.phone.trim() && !draft.email.trim() || !draft.preferredDate || !selected.length || selected.some((item) => item.centreId !== draft.centreId)) {
      setMessage("Some required information is missing or a selected catalogue item is no longer available. Return to the form and review your details."); return;
    }
    if (draft.visitType === "HOME_COLLECTION" && (!draft.addressLine1.trim() || !draft.city.trim() || !draft.state.trim() || !draft.postalCode.trim())) {
      setMessage("Enter the complete home collection address before sending the request."); return;
    }
    const payload = {
      centreId: draft.centreId, firstName: draft.firstName, lastName: draft.lastName, phone: draft.phone, email: draft.email,
      category: selected[0]!.serviceType, requestTopic: "GENERAL", requestKind: "BOOKING_REQUEST",
      requestedCatalogueItems: selected.map((item) => ({ id: item.id, version: item.version })),
      preferredDate: draft.preferredDate, preferredTimeWindow: draft.preferredTimeWindow,
      visitType: draft.visitType, ...(draft.visitType === "HOME_COLLECTION" ? { addressLine1: draft.addressLine1, addressLine2: draft.addressLine2, city: draft.city, state: draft.state, postalCode: draft.postalCode, requestedHomeCharge: draft.homeCharge } : {}),
      message: `Public booking request for ${selected.map((item) => item.displayName).join(", ")}. Preferred visit: ${draft.visitType}.`,
      responsePermission: draft.responsePermission,
    };
    setBusy(true); setMessage("Sending your request securely for staff review…");
    try {
      const body = JSON.stringify(payload);
      const idempotencyKey = getPublicBookingIdempotencyKey();
      const response = await fetch("/api/public/enquiries", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body });
      const result = await response.json() as { accepted?: boolean; reference?: string; error?: string };
      if (response.status === 202 && result.accepted && result.reference) {
        clearPublicBookingIdempotencyKey();
        setReceipt(result.reference);
        update(emptyDraft);
        setMessage("");
        router.push("/book/confirmation");
        return;
      }
      if (response.status < 500 && response.status !== 409) clearPublicBookingIdempotencyKey();
      setMessage(response.status === 409 ? "This request key is already associated with a different submission. Do not submit again; contact the centre to check whether your earlier request was received." : result.error === "catalogue_selection_unavailable" ? "A selected catalogue version is no longer published. Return to the catalogue and select a current item." : result.error === "centre_unavailable" ? "This centre is not accepting public requests." : response.status === 429 ? "Too many recent requests were received for this contact. Please contact the centre through its approved channel." : "The request was not confirmed as submitted. Retry without changing it so the same request key is reused.");
    } catch {
      setMessage("We could not confirm the result. Retry without changing the request so the same idempotency key is reused.");
    } finally { setBusy(false); }
  }

  const title = step === "select" ? "Request a Test or Package" : step === "review" ? "Review Your Request" : step === "payment" ? "Payment Unavailable" : "Request Received";
  const currentStep = step === "select" ? 1 : step === "review" ? 6 : 7;
  const selectedCentre = centres.find((item) => item.id === draft.centreId);
  const summary = <aside className="r-book-summary"><h2>Request Summary</h2><div className="r-summary-patient"><b>Contact details</b><span>{draft.firstName || "Not entered"} {draft.lastName}</span><small>Kept in memory for this journey only</small></div>{draft.selected.map((item) => <div className="r-summary-line" key={item.id}><span>{item.displayName} · v{item.version}</span><b>{formatter.format(Number(item.priceAmount))}</b></div>)}<div className="r-summary-line"><span>Requested home collection fee</span><b>{draft.visitType === "HOME_COLLECTION" ? formatter.format(Number(draft.homeCharge)) : formatter.format(0)}</b></div><div className="r-summary-total"><span>Illustrative catalogue total</span><b>{formatter.format(selectedTotal + (draft.visitType === "HOME_COLLECTION" ? Number(draft.homeCharge) : 0))}</b></div><div className="r-summary-safe">Final service, price and availability require Rudra staff review.</div></aside>;

  return <div className="r-public r-booking-page"><PreviewBanner/><div className="r-booking-head"><div className="r-breadcrumb"><Link href="/">Home</Link> › <Link href="/book">Request a test / package</Link> {step !== "select" ? <> › {title}</> : null}</div><div className="r-booking-title"><div><h1>{title}</h1><p>{step === "select" ? "Choose published services and send a request for Rudra staff to review." : step === "review" ? "Confirm your requested details before sending." : step === "payment" ? "Online payments are not available in this development workflow." : "Your enquiry reference confirms receipt for review only."}</p></div></div></div><Steps current={currentStep}/>
    {step === "select" && <form className="r-book-layout" onSubmit={goReview}><div className="r-book-main">
      <section className="r-book-panel"><h2><span>1</span> Select a centre and services</h2><label>Centre<select required value={draft.centreId} onChange={(event) => { update({ centreId: event.target.value, selected: [] }); setServices([]); setCatalogueHasMore(false); setCataloguePage(1); setLoading(true); setAppliedCatalogueSearch(""); setCatalogueSearch(""); }}><option value="">Choose a centre</option>{centres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name} ({centre.code})</option>)}</select></label>{draft.centreId && <div className="r-book-catalogue-search"><label>Search published tests and packages<input value={catalogueSearch} maxLength={80} onChange={(event) => setCatalogueSearch(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); const nextQuery = catalogueSearch.trim(); if (nextQuery !== appliedCatalogueSearch) { setLoading(true); setAppliedCatalogueSearch(nextQuery); } } }}/></label><button className="r-button r-button-outline" type="button" onClick={() => { const nextQuery = catalogueSearch.trim(); if (nextQuery !== appliedCatalogueSearch) { setLoading(true); setAppliedCatalogueSearch(nextQuery); } }}>Search catalogue</button>{appliedCatalogueSearch && <button className="r-back-link" type="button" onClick={() => { setLoading(true); setCatalogueSearch(""); setAppliedCatalogueSearch(""); }}>Clear search</button>}</div>}{loading ? <p>Loading current centres and published catalogue…</p> : <div className="r-book-service-list">{centreServices.map((item) => <label className="r-book-service-option" key={item.id}><input type="checkbox" checked={selectedIds.has(item.id)} onChange={(event) => selectService(item.id, event.target.checked)}/><span><b>{item.displayName}</b><small>{item.serviceType} · {item.serviceCode} · published version {item.version}</small></span><strong>{new Intl.NumberFormat("en-IN", { style: "currency", currency: item.currency, maximumFractionDigits: 2 }).format(Number(item.priceAmount))}</strong></label>)}{!centreServices.length && <p>{draft.centreId ? "No currently published tests or packages are available for this search." : "Select a centre to view its published tests and packages."}</p>}{catalogueHasMore && <button className="r-button r-button-outline" type="button" disabled={loading} onClick={() => void loadMoreCatalogue()}>Load more services</button>}</div>}</section>
      <section className="r-book-panel"><h2><span>2</span> Your contact details</h2><div className="r-form-grid"><label>First name<input autoComplete="given-name" required maxLength={100} value={draft.firstName} onChange={(e) => update({ firstName: e.target.value })}/></label><label>Last name<input autoComplete="family-name" required maxLength={100} value={draft.lastName} onChange={(e) => update({ lastName: e.target.value })}/></label><label>Mobile number<input autoComplete="tel" inputMode="tel" maxLength={32} value={draft.phone} onChange={(e) => update({ phone: e.target.value })}/></label><label>Email address<input autoComplete="email" type="email" maxLength={254} value={draft.email} onChange={(e) => update({ email: e.target.value })}/></label></div><small>Provide a phone number or email. Avoid entering symptoms, medical history or report details.</small></section>
      <div className="r-book-lower"><section className="r-book-panel"><h2><span>3</span> Visit preference</h2><div className="r-method-switch"><label><input type="radio" checked={draft.visitType === "CENTRE"} onChange={() => update({ visitType: "CENTRE" })}/> Visit at centre</label><label><input type="radio" checked={draft.visitType === "HOME_COLLECTION"} onChange={() => update({ visitType: "HOME_COLLECTION" })}/> Home collection request</label></div><p>Home collection requests require staff to confirm serviceability, availability and final charge.</p>{draft.visitType === "HOME_COLLECTION" && <label>Requested standard home collection fee<select value={draft.homeCharge} onChange={(e) => update({ homeCharge: e.target.value as BookingDraft["homeCharge"] })}><option value="75">₹75 · subject to staff verification</option><option value="99">₹99 · subject to staff verification</option><option value="150">₹150 · subject to staff verification</option></select></label>}</section>
      <section className="r-book-panel"><h2><span>4</span> Preferred location & time</h2>{draft.visitType === "HOME_COLLECTION" && <><label>Address line 1<input required maxLength={160} value={draft.addressLine1} onChange={(e) => update({ addressLine1: e.target.value })}/></label><label>Address line 2<input maxLength={160} value={draft.addressLine2} onChange={(e) => update({ addressLine2: e.target.value })}/></label><label>City<input required maxLength={100} value={draft.city} onChange={(e) => update({ city: e.target.value })}/></label><label>State<input required maxLength={100} value={draft.state} onChange={(e) => update({ state: e.target.value })}/></label><label>PIN code<input required inputMode="numeric" maxLength={16} value={draft.postalCode} onChange={(e) => update({ postalCode: e.target.value })}/></label></>}<label>Preferred date<input type="date" required value={draft.preferredDate} onChange={(e) => update({ preferredDate: e.target.value })}/></label><label>Preferred time window<input maxLength={120} placeholder="e.g. morning" value={draft.preferredTimeWindow} onChange={(e) => update({ preferredTimeWindow: e.target.value })}/></label><small>Requested timing is not a reserved or confirmed slot.</small></section></div>
      <section className="r-book-panel"><label className="task-checkbox"><input type="checkbox" checked={draft.responsePermission} onChange={(e) => update({ responsePermission: e.target.checked })}/> Rudra staff may contact me about this specific request. This is not marketing consent.</label></section><button className="r-button r-continue" disabled={loading || busy || !draft.centreId} type="submit">Review request →</button><p role="status" aria-live="polite">{message}</p>
    </div>{summary}</form>}
    {step === "review" && <div className="r-book-layout"><main className="r-book-main"><section className="r-book-panel"><h2>Contact information</h2><p>{draft.firstName} {draft.lastName}</p><p>{draft.phone || draft.email}</p><small>Contact details are held in application memory only and are submitted securely to the enquiry API.</small></section><section className="r-book-panel"><h2>Selected services</h2>{draft.selected.map((item) => <p key={item.id}>{item.displayName} · {item.serviceCode} · approved catalogue v{item.version} · {formatter.format(Number(item.priceAmount))}</p>)}<p>Centre: {selectedCentre?.name ?? "Please return and select a centre"}</p></section><section className="r-book-panel"><h2>Visit request</h2><p>{draft.visitType === "HOME_COLLECTION" ? `Home collection · requested fee ${formatter.format(Number(draft.homeCharge))} (not accepted until staff review)` : "Centre visit"}</p>{draft.visitType === "HOME_COLLECTION" && <p>{[draft.addressLine1, draft.addressLine2, draft.city, draft.state, draft.postalCode].filter(Boolean).join(", ")}</p>}<p>{draft.preferredDate} · {draft.preferredTimeWindow || "Time window not specified"}</p></section><section className="r-book-panel r-prep-warning"><h2>Not a confirmed booking</h2><p>Sending this request creates an enquiry for authorized staff review. It does not create an appointment, reserve a time, authorize a fee, or submit a payment.</p></section><div className="r-payment-preview"><div><h3>Online payment unavailable</h3><p>No payment provider is configured for this development workflow. Do not enter payment details.</p></div><button className="r-button" type="button" disabled>Payment unavailable</button></div><button className="r-button" type="button" disabled={busy} onClick={() => void submitRequest()}>{busy ? "Sending request…" : "Send request for staff review"}</button><Link className="r-back-link" href="/book">← Edit request</Link><p role="status" aria-live="polite">{message}</p></main>{summary}</div>}
    {step === "payment" && <div className="r-confirmation"><section className="r-book-panel r-prep-warning"><h2>Online payment is unavailable</h2><p>No payment provider is configured. No payment can be initiated or confirmed here.</p><Link className="r-button" href="/book">Return to request form</Link></section></div>}
    {step === "confirmation" && <div className="r-confirmation"><div className="r-confirmation-hero"><div className="r-check-circle">✓</div><div><h1>{receipt ? "Request received for review" : "No request reference available"}</h1><h2>{receipt ? "This is an enquiry receipt, not an appointment confirmation." : "Submit a request before viewing its receipt."}</h2><p>{receipt ? "Rudra staff must verify the service, centre, price, availability and next steps. No slot was reserved and no payment was taken." : "The receipt is kept in application memory and is not recoverable after a page reload."}</p>{receipt && <p><strong>Enquiry reference:</strong> {receipt}</p>}</div></div><div className="r-confirmation-actions"><Link className="r-button r-button-outline" href="/tests">Explore tests</Link><Link className="r-button" href="/book" onClick={() => reset()}>Start another request</Link></div></div>}
  </div>;
}
