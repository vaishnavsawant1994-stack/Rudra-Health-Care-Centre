"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { IdempotencyAttempt } from "@/lib/idempotency-attempt";
import { resolveAuthorizedCentreFilter } from "@/lib/authorized-centre-selection";
import { canCreateSupportFollowupAtCentre } from "@/lib/staff-task-access";
import { getExactPublicBookingService, getPublicBookingPrefill, getPublicBookingServiceText, getPublicCampaignAttribution } from "@/lib/public-booking-prefill";
import { getPublicEnquiryReceiptCopy } from "@/lib/public-enquiry-receipt";
import type { PermissionGrant } from "@/server/permissions";

type Centre = { id: string; name: string; code: string };
type Assignee = { id: string; displayName: string; staffCode: string };
type PublicBookingService = { id: string; centreId: string; serviceType: "TEST" | "PACKAGE"; serviceCode: string; version: number; displayName: string; priceAmount: string; currency: string };
type Enquiry = { id: string; reference: string; status: string; version: number; centreId: string; createdAt: string; resultingLeadId: string | null; firstName: string; lastName: string; organizationName?: string | null; phone: string | null; email: string | null; category: string; requestTopic?: "GENERAL" | "CORPORATE" | "DOCTOR" | "PARTNER"; message: string; responsePermission: boolean; submittedAt: string; requestKind?: "INQUIRY" | "BOOKING_REQUEST"; requestedService?: string | null; preferredDate?: string | null; preferredTimeWindow?: string | null; visitType?: "CENTRE" | "HOME_COLLECTION" | null; collectionAddress?: { line1: string; line2?: string; city: string; state: string; postalCode: string } | null };

export function PublicEnquiryForm({ mode = "inquiry", topic = "GENERAL" }: { mode?: "inquiry" | "booking"; topic?: "GENERAL" | "CORPORATE" | "DOCTOR" | "PARTNER" }) {
  const [centres, setCentres] = useState<Centre[]>([]);
  const [selectedCentreId, setSelectedCentreId] = useState("");
  const [requestedService, setRequestedService] = useState("");
  const [catalogueServices, setCatalogueServices] = useState<PublicBookingService[]>([]);
  const [catalogueQuery, setCatalogueQuery] = useState("");
  const [appliedCatalogueQuery, setAppliedCatalogueQuery] = useState("");
  const [cataloguePage, setCataloguePage] = useState(1);
  const [catalogueHasMore, setCatalogueHasMore] = useState(false);
  const [catalogueLoadingMore, setCatalogueLoadingMore] = useState(false);
  const [catalogueState, setCatalogueState] = useState("");
  const [selectedCatalogueServiceId, setSelectedCatalogueServiceId] = useState("");
  const [cataloguePrefill, setCataloguePrefill] = useState<{ itemId: string; version: number } | null>(null);
  const [state, setState] = useState("Loading currently listed centres…");
  const [busy, setBusy] = useState(false);
  const [visitType, setVisitType] = useState("CENTRE");
  const [reviewingBooking, setReviewingBooking] = useState(false);
  const [bookingReview, setBookingReview] = useState<{ centre: string; name: string; contact: string; service: string; visit: string; preferredDate: string; timeWindow: string; address: string; message: string } | null>(null);
  const [submitted, setSubmitted] = useState<{ kind: "booking" | "inquiry"; reference: string | null } | null>(null);
  const submissionAttempt = useRef(new IdempotencyAttempt());
  const catalogueRequestSequence = useRef(0);
  useEffect(() => { let live = true; void fetch("/api/public/centres", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json() as { centres?: Centre[] } })).then(({ response, body }) => { if (!live) return; const rows = response.ok ? body.centres ?? [] : []; setCentres(rows); if (mode === "booking") { const prefill = getPublicBookingPrefill(window.location.search, rows); setSelectedCentreId(prefill.centreId); setRequestedService(prefill.requestedService); setVisitType(prefill.visitType); setCataloguePrefill(prefill.requestedCatalogueVersion === null ? null : { itemId: prefill.requestedCatalogueItemId, version: prefill.requestedCatalogueVersion }); } setState(rows.length ? "" : "No Rudra centre is currently accepting public enquiries."); }).catch(() => { if (live) setState("Centre information is unavailable. Please try again later."); }); return () => { live = false; }; }, [mode]);
  const loadBookingServices = useCallback(async (page: number, append: boolean) => {
    const requestSequence = ++catalogueRequestSequence.current;
    if (mode !== "booking" || !selectedCentreId) { setCatalogueServices([]); setCatalogueHasMore(false); setCatalogueState(""); return; }
    setCatalogueLoadingMore(append);
    if (!append) setCatalogueState("Loading published tests and packages…");
    try {
      const params = new URLSearchParams({ centreId: selectedCentreId, page: String(page), pageSize: "50" });
      if (appliedCatalogueQuery) params.set("q", appliedCatalogueQuery);
      const response = await fetch(`/api/public/catalogue?${params}`, { cache: "no-store" });
      const body = await response.json() as { items?: PublicBookingService[]; hasMore?: boolean };
      if (!response.ok) throw new Error("catalogue_unavailable");
      if (requestSequence !== catalogueRequestSequence.current) return;
      const next = (body.items ?? []).filter((item) => item.centreId === selectedCentreId && ["TEST", "PACKAGE"].includes(item.serviceType));
      setCatalogueServices((current) => {
        if (append) return [...current, ...next.filter((item) => !current.some((existing) => existing.id === item.id))];
        const pinnedSelection = cataloguePrefill ? current.find((item) => item.id === cataloguePrefill.itemId) : undefined;
        return pinnedSelection && !next.some((item) => item.id === pinnedSelection.id) ? [pinnedSelection, ...next] : next;
      });
      setCataloguePage(page);
      setCatalogueHasMore(body.hasMore === true);
      setCatalogueState(next.length || append ? "" : "No published, verified services match this search. You can still enter a service request manually.");
    } catch {
      if (requestSequence !== catalogueRequestSequence.current) return;
      if (!append) setCatalogueServices([]);
      setCatalogueHasMore(false);
      setCatalogueState("The published catalogue is unavailable. You can still send a service request for staff review.");
    } finally { if (requestSequence === catalogueRequestSequence.current) setCatalogueLoadingMore(false); }
  }, [appliedCatalogueQuery, cataloguePrefill, mode, selectedCentreId]);
  useEffect(() => { void Promise.resolve().then(() => loadBookingServices(1, false)); }, [loadBookingServices]);
  useEffect(() => {
    if (mode !== "booking" || !cataloguePrefill || !selectedCentreId) return;
    let live = true;
    void fetch(`/api/public/catalogue/${encodeURIComponent(cataloguePrefill.itemId)}`, { cache: "no-store" })
      .then(async (response) => ({ response, body: await response.json() as { item?: PublicBookingService } }))
      .then(({ response, body }) => {
        if (!live) return;
        const item = response.ok && body.item
          ? getExactPublicBookingService({ item: body.item, requestedItemId: cataloguePrefill.itemId, requestedVersion: cataloguePrefill.version, centreId: selectedCentreId })
          : null;
        if (!item) {
          setCataloguePrefill(null);
          setCatalogueState("The linked catalogue version is no longer current and published. Review the service selection before sending your request.");
          return;
        }
        setCatalogueServices((current) => current.some((service) => service.id === item.id) ? current : [item, ...current]);
        setSelectedCatalogueServiceId(item.id);
        setRequestedService(getPublicBookingServiceText(item.id, [item]) ?? "");
      })
      .catch(() => { if (live) { setCataloguePrefill(null); setCatalogueState("The linked catalogue service could not be verified. Please select a currently published service."); } });
    return () => { live = false; };
  }, [cataloguePrefill, mode, selectedCentreId]);
  function reviewBookingRequest(form: HTMLFormElement | null) {
    if (mode !== "booking" || !form || !form.reportValidity()) return;
    const values = new FormData(form);
    const selected = catalogueServices.find((item) => item.id === selectedCatalogueServiceId);
    const centre = centres.find((item) => item.id === String(values.get("centreId")));
    const address = ["addressLine1", "addressLine2", "city", "state", "postalCode"].map((name) => String(values.get(name) ?? "").trim()).filter(Boolean).join(", ");
    setBookingReview({
      centre: centre ? `${centre.name} (${centre.code})` : "Selected Rudra centre",
      name: `${String(values.get("firstName") ?? "").trim()} ${String(values.get("lastName") ?? "").trim()}`.trim(),
      contact: [values.get("phone"), values.get("email")].map((value) => String(value ?? "").trim()).filter(Boolean).join(" · "),
      service: selected ? `${selected.displayName} (${selected.serviceCode})` : String(values.get("requestedService") ?? "").trim() || "Service to be reviewed by Rudra staff",
      visit: visitType === "HOME_COLLECTION" ? "Home collection request" : "Centre visit request",
      preferredDate: String(values.get("preferredDate") ?? ""),
      timeWindow: String(values.get("preferredTimeWindow") ?? "").trim(),
      address,
      message: String(values.get("message") ?? "").trim(),
    });
    setReviewingBooking(true);
    setState("");
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const values = Object.fromEntries(new FormData(form).entries());
    const selectedService = catalogueServices.find((item) => item.id === selectedCatalogueServiceId);
    const body = { ...values, ...(selectedService ? { requestedCatalogueItemId: selectedService.id, requestedCatalogueVersion: selectedService.version } : {}), campaignAttribution: getPublicCampaignAttribution(window.location.search), requestTopic: topic, requestKind: mode === "booking" ? "BOOKING_REQUEST" : "INQUIRY", responsePermission: values.responsePermission === "on" };
    setBusy(true); setState("Sending your enquiry securely…");
    try {
      const serializedBody = JSON.stringify(body);
      const idempotencyKey = await submissionAttempt.current.keyFor(serializedBody);
      const response = await fetch("/api/public/enquiries", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: serializedBody });
      const result = await response.json() as { accepted?: boolean; reference?: string; error?: string };
      if (response.status === 202 && result.accepted) { submissionAttempt.current.clear(); form.reset(); setVisitType("CENTRE"); setSelectedCentreId(""); setRequestedService(""); setSelectedCatalogueServiceId(""); setCatalogueQuery(""); setAppliedCatalogueQuery(""); setReviewingBooking(false); setBookingReview(null); setSubmitted({ kind: mode, reference: typeof result.reference === "string" ? result.reference : null }); setState(""); return; }
      // A definitive client response did not commit the request. Clear this
      // attempt; an edited retry also gets a new key through its body digest.
      if (response.status < 500) submissionAttempt.current.clear();
      setState(result.error === "centre_unavailable" ? "That centre is not accepting online enquiries right now." : response.status === 429 ? "This contact has reached the recent enquiry limit. Please wait and try again later, or contact the centre through its approved channel." : response.status === 409 ? "The submission could not be safely retried. Review the form and submit again." : "We could not record the enquiry. Your information was not confirmed as submitted; try again later.");
    } catch { setState("We could not confirm submission. Retry without changing the form to safely check whether it was recorded."); }
    finally { setBusy(false); }
  }
  if (submitted) { const receipt = getPublicEnquiryReceiptCopy(submitted.kind); return <section className="admin-card public-enquiry-form-card" aria-labelledby="public-enquiry-received-title">
    <p className="eyebrow">Rudra Health Care Centre</p>
    <h2 id="public-enquiry-received-title">{receipt.title}</h2>
    {submitted.reference && <p><strong>Reference:</strong> <span>{submitted.reference}</span></p>}
    <p>{receipt.message}</p>{receipt.nextStep && <p>{receipt.nextStep}</p>}
    <div className="page-actions"><button type="button" className="button button-secondary" onClick={() => setSubmitted(null)}>Send another request</button><Link className="button button-secondary" href="/centres">View Rudra centres</Link><Link className="button button-secondary" href="/">Return to home</Link></div>
  </section>; }
  return <section className="admin-card public-enquiry-form-card"><h2>{mode === "booking" ? "Request an appointment" : "Send an enquiry"}</h2><p>{mode === "booking" ? "Share your preferred service, date and visit type. This request does not reserve a slot or create an appointment. Staff must review it and confirm availability through Rudra's scheduling workflow." : "Use this form for a service question or callback request."} Do not include medical results or urgent health information. Staff review submissions; no message is sent automatically.</p>
    {centres.length > 0 ? <form className="admin-form public-enquiry-form" onSubmit={submit}>
      <div hidden={reviewingBooking}>
      <label>Centre<select name="centreId" required value={selectedCentreId} onChange={(event) => { setSelectedCentreId(event.target.value); setSelectedCatalogueServiceId(""); setCatalogueServices([]); setRequestedService(""); setCataloguePrefill(null); }}><option value="" disabled>Select a listed centre</option>{centres.map((centre) => <option value={centre.id} key={centre.id}>{centre.name} ({centre.code})</option>)}</select></label>
      <label>First name<input name="firstName" autoComplete="given-name" required maxLength={100}/></label>
      <label>Last name<input name="lastName" autoComplete="family-name" required maxLength={100}/></label>
      {topic !== "GENERAL" && <label>Organization or practice name (optional)<input name="organizationName" autoComplete="organization" maxLength={160}/></label>}
      <label>Phone (provide phone or email)<input name="phone" type="tel" autoComplete="tel" minLength={7} maxLength={32}/></label>
      <label>Email (provide phone or email)<input name="email" type="email" autoComplete="email" maxLength={254}/></label>
      {mode === "inquiry" ? <label>Enquiry type<select name="category" defaultValue="GENERAL"><option value="GENERAL">General question</option><option value="TEST">Diagnostic test</option><option value="PACKAGE">Diagnostic package</option><option value="HOME_COLLECTION">Home collection</option><option value="SUPPORT">Service issue or feedback</option><option value="OTHER">Other</option></select><small>Service issues are routed for staff review. Do not include diagnostic results, medical history, or urgent health information.</small></label> : <>
        <fieldset><legend>Choose a published test or package (optional)</legend><div className="form-grid"><label>Search published services<input value={catalogueQuery} maxLength={80} onChange={(event) => setCatalogueQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); setSelectedCatalogueServiceId(""); setAppliedCatalogueQuery(catalogueQuery.trim()); } }} placeholder="Name or service code"/></label><button type="button" className="button button-secondary" onClick={() => { setSelectedCatalogueServiceId(""); setAppliedCatalogueQuery(catalogueQuery.trim()); }}>Search catalogue</button><label>Published services<select value={selectedCatalogueServiceId} onChange={(event) => { const id = event.target.value; setSelectedCatalogueServiceId(id); if (id) { const text = getPublicBookingServiceText(id, catalogueServices); if (text) setRequestedService(text); } }}><option value="">Choose a currently published service</option>{catalogueServices.map((item) => <option key={item.id} value={item.id}>{item.displayName} ({item.serviceCode}) · {item.serviceType === "TEST" ? "Test" : "Package"} · {item.currency === "INR" ? "₹" : `${item.currency} `}{item.priceAmount}</option>)}</select><small>Listing or selecting a service does not confirm centre availability, reserve a time, or create an appointment.</small></label>{catalogueHasMore && <button type="button" className="button button-secondary" disabled={catalogueLoadingMore} onClick={() => void loadBookingServices(cataloguePage + 1, true)}>{catalogueLoadingMore ? "Loading…" : "Load more services"}</button>}</div>{catalogueState && <p role="status">{catalogueState}</p>}</fieldset>
        <label>Requested service or test/package<input name="requestedService" value={requestedService} onChange={(event) => { setRequestedService(event.target.value); setSelectedCatalogueServiceId(""); }} maxLength={160} placeholder="Choose above or enter a request manually"/><small>The selected name/reference is a request only. Staff verify current service eligibility, price and availability before confirming a booking.</small></label>
        <label>Visit type<select name="visitType" value={visitType} onChange={(event) => setVisitType(event.target.value)}><option value="CENTRE">Centre visit</option><option value="HOME_COLLECTION">Home collection</option></select></label>
        <label>Preferred date<input name="preferredDate" type="date" required/></label>
        <label>Preferred time window<input name="preferredTimeWindow" maxLength={120} placeholder="For example, morning"/></label>
        {visitType === "HOME_COLLECTION" && <fieldset><legend>Requested collection address</legend><label>Address line 1<input name="addressLine1" autoComplete="address-line1" required maxLength={160}/></label><label>Address line 2<input name="addressLine2" autoComplete="address-line2" maxLength={160}/></label><label>City<input name="city" autoComplete="address-level2" required maxLength={100}/></label><label>State<input name="state" autoComplete="address-level1" required maxLength={100}/></label><label>Postal code<input name="postalCode" autoComplete="postal-code" required maxLength={16}/></label></fieldset>}
        {visitType === "HOME_COLLECTION" ? <input type="hidden" name="category" value="HOME_COLLECTION"/> : <label>Service interest<select name="category" defaultValue="GENERAL"><option value="GENERAL">Not sure yet</option><option value="TEST">Diagnostic test</option><option value="PACKAGE">Diagnostic package</option></select></label>}
      </>}
      <label>How can we help?<textarea name="message" rows={4} minLength={5} maxLength={1200} required/></label>
      <label className="task-checkbox"><input type="checkbox" name="responsePermission"/>I am requesting a response to this enquiry. This does not opt me into marketing or establish ongoing contact consent.</label>
      <div className="public-enquiry-honeypot" aria-hidden="true"><label>Website<input name="website" tabIndex={-1} autoComplete="off"/></label></div>
      </div>
      {mode === "booking" && reviewingBooking && bookingReview && <section className="notice" aria-labelledby="booking-review-title"><div><h3 id="booking-review-title">Review your visit request</h3><dl className="lead-details"><div><dt>Centre</dt><dd>{bookingReview.centre}</dd></div><div><dt>Name</dt><dd>{bookingReview.name}</dd></div><div><dt>Contact details</dt><dd>{bookingReview.contact}</dd></div><div><dt>Requested service</dt><dd>{bookingReview.service}</dd></div><div><dt>Visit type</dt><dd>{bookingReview.visit}</dd></div><div><dt>Preferred date</dt><dd>{bookingReview.preferredDate}</dd></div>{bookingReview.timeWindow && <div><dt>Preferred time</dt><dd>{bookingReview.timeWindow}</dd></div>}{bookingReview.address && <div><dt>Requested address</dt><dd>{bookingReview.address}</dd></div>}<div><dt>Message</dt><dd>{bookingReview.message}</dd></div></dl><p>No appointment slot or fee is reserved or quoted here. Rudra staff must verify service eligibility, pricing, and availability before confirming a booking.</p><div className="page-actions"><button type="button" className="button button-secondary" disabled={busy} onClick={() => setReviewingBooking(false)}>Edit request</button><button type="submit" className="button button-primary" disabled={busy}>{busy ? "Sending…" : "Send request for staff review"}</button></div></div></section>}
      {mode === "booking" && !reviewingBooking && <button type="button" className="button button-primary" disabled={busy || !selectedCentreId} onClick={(event) => reviewBookingRequest(event.currentTarget.form)}>Review request</button>}
      {mode === "inquiry" && <button type="submit" className="button button-primary" disabled={busy}>{busy ? "Sending…" : "Send enquiry"}</button>}
      <p role="status" aria-live="polite">{state}</p>
    </form> : <p role="status">{state}</p>}
  </section>;
}

export function PublicEnquiryReview({ staffId, canCreate, canAssign, canDismiss, taskGrants, relationshipGrants }: { staffId: string; canCreate: boolean; canAssign: boolean; canDismiss: boolean; taskGrants: PermissionGrant[]; relationshipGrants: PermissionGrant[] }) {
  const followupAttempts = useRef(new Map<string, IdempotencyAttempt>());
  const [centres, setCentres] = useState<Centre[]>([]); const [centreId, setCentreId] = useState(""); const [selectedEnquiryId, setSelectedEnquiryId] = useState<string | null>(null); const [assignees, setAssignees] = useState<Assignee[]>([]); const [rows, setRows] = useState<Enquiry[]>([]); const [reason, setReason] = useState<Record<string, string>>({}); const [state, setState] = useState("Loading authorized enquiry centres…"); const [busyId, setBusyId] = useState<string | null>(null); const [page, setPage] = useState(1); const [hasMore, setHasMore] = useState(false);
  const load = useCallback(async (nextCentre: string, requestedPage = 1, exactEnquiryId: string | null = null): Promise<number | null> => { if (!nextCentre) return null; setState("Loading enquiries…"); try { const query = new URLSearchParams({ centreId: nextCentre, ...(exactEnquiryId ? { enquiryId: exactEnquiryId } : { page: String(requestedPage) }) }); const response = await fetch(`/api/public/enquiries?${query}`, { cache: "no-store" }); const body = await response.json() as { enquiries?: Enquiry[]; page?: number; hasMore?: boolean }; if (!response.ok) throw new Error(); const enquiries = body.enquiries ?? []; setRows(enquiries); setPage(body.page ?? requestedPage); setHasMore(body.hasMore === true); setState(enquiries.length ? "" : exactEnquiryId ? "This enquiry is unavailable in the selected authorized centre." : "No public enquiries are awaiting review at this centre."); return enquiries.length; } catch { setRows([]); setHasMore(false); setState("Enquiries could not be loaded in your authorized scope."); return null; } }, []);
  useEffect(() => { let live = true; void fetch("/api/leads/centres", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json() as { centres?: Centre[] } })).then(({ response, body }) => { if (!live) return; const list = response.ok ? body.centres ?? [] : []; setCentres(list); if (list.length) { const params = new URLSearchParams(window.location.search); const requested = params.get("centreId") ?? undefined; const selected = resolveAuthorizedCentreFilter(list, requested) || list[0].id; const requestedEnquiry = params.get("enquiryId"); const exactId = requestedEnquiry && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedEnquiry) ? requestedEnquiry : null; setCentreId(selected); setSelectedEnquiryId(exactId); void load(selected, 1, exactId); } else setState("No authorized centre is available."); }).catch(() => { if (live) setState("Centre access is unavailable."); }); return () => { live = false; }; }, [load]);
  useEffect(() => { if (!canAssign || !centreId) return; let live = true; void fetch(`/api/leads/assignees?centreId=${encodeURIComponent(centreId)}`, { cache: "no-store" }).then(async (response) => ({ response, body: await response.json() as { staff?: Assignee[] } })).then(({ response, body }) => { if (live) setAssignees(response.ok ? body.staff ?? [] : []); }).catch(() => { if (live) setAssignees([]); }); return () => { live = false; }; }, [canAssign, centreId]);
  async function review(row: Enquiry, action: "CONVERT_TO_LEAD" | "CONVERT_TO_RELATIONSHIP" | "DISMISS", extra: Record<string, unknown>) { setBusyId(row.id); setState("Saving review…"); try { const response = await fetch("/api/public/enquiries", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: row.id, action, expectedVersion: row.version, ...extra }) }); const body = await response.json() as { error?: string; leadId?: string; leadNumber?: string; relationshipNumber?: string }; if (!response.ok) { setState(body.error === "possible_duplicate_review_required" ? "A possible matching CRM lead exists. Review the CRM directory before deciding how to proceed." : body.error === "invalid_assignee" ? "Select an active staff member assigned to this centre." : body.error === "organization_and_response_request_required" ? "A response must be requested and an organization/practice name provided before creating an inactive profile." : "This enquiry changed or could not be reviewed. Refresh and try again."); return; } const shown = await load(centreId, page); if (shown === 0 && page > 1) await load(centreId, page - 1); setState(body.leadId ? `Enquiry converted to ${body.leadNumber}.` : body.relationshipNumber ? `Inactive relationship profile ${body.relationshipNumber} created for review; no agreement or outreach was activated.` : "Enquiry dismissed; its history is retained."); } catch { setState("Review could not be confirmed. Refresh before retrying."); } finally { setBusyId(null); } }
  async function createFollowup(row: Enquiry) {
    const attempt = followupAttempts.current.get(row.id) ?? new IdempotencyAttempt(`rudra:public-enquiry-followup:${staffId}:${row.id}`);
    followupAttempts.current.set(row.id, attempt);
    const task = { centreId: row.centreId, assignedStaffId: staffId, title: "Review website enquiry", description: "Review the request and confirm the permitted next step. Do not contact the enquirer until contact permission is verified.", reference: { type: "PUBLIC_ENQUIRY", id: row.id }, taskType: "SUPPORT_REQUEST", priority: "NORMAL", dueAt: null, requiresApproval: false };
    setBusyId(row.id); setState("Creating an internal review task…");
    try {
      const body = JSON.stringify(task);
      const idempotencyKey = await attempt.keyFor(body);
      const response = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body });
      const result = await response.json() as { task?: { taskNumber?: string }; error?: string };
      if (!response.ok) {
        if (response.status < 500) attempt.clear();
        setState(response.status === 403 ? "You do not have permission to create a support follow-up for this centre." : response.status === 404 ? "The enquiry is no longer available in your authorized centre." : "The internal review task could not be created. Refresh before retrying.");
        return;
      }
      attempt.clear(); followupAttempts.current.delete(row.id);
      setState(result.task?.taskNumber ? `Internal review task ${result.task.taskNumber} created. Contact details were not copied into the task.` : "Internal review task created. Contact details were not copied into the task.");
    } catch { setState("Task creation could not be confirmed. Retry without changing the action to safely check whether it was recorded."); }
    finally { setBusyId(null); }
  }
  return <section className="admin-card"><div className="task-toolbar"><div><h2>{selectedEnquiryId ? "Public enquiry details" : "Public enquiries awaiting review"}</h2><p>These submissions are not patient records or verified CRM leads until a permitted staff review action creates a lead.</p></div><label>Centre<select value={centreId} onChange={(event) => { setCentreId(event.target.value); setSelectedEnquiryId(null); setPage(1); void load(event.target.value, 1); }}><option value="">Select centre</option>{centres.map((centre) => <option value={centre.id} key={centre.id}>{centre.name} ({centre.code})</option>)}</select></label></div>
    {rows.map((row) => <article className="admin-card public-enquiry-item" key={row.id}><div className="task-toolbar"><div><p className="eyebrow">{row.reference} · {new Date(row.createdAt).toLocaleString()}</p><h3>{row.firstName} {row.lastName}</h3></div><span className="lead-status">{row.requestKind === "BOOKING_REQUEST" ? "BOOKING REQUEST · NOT CONFIRMED" : `${row.requestTopic ?? "GENERAL"} · ${row.category === "SUPPORT" ? "SERVICE ISSUE / FEEDBACK" : row.category.replaceAll("_", " ")}`}</span></div>{row.organizationName && <p><strong>Organization or practice:</strong> {row.organizationName}</p>}{row.requestKind === "BOOKING_REQUEST" && <dl className="lead-details"><div><dt>Requested service</dt><dd>{row.requestedService || "Not specified"}</dd></div><div><dt>Preferred date</dt><dd>{row.preferredDate || "Not specified"} {row.preferredTimeWindow || ""}</dd></div><div><dt>Visit type</dt><dd>{row.visitType === "HOME_COLLECTION" ? "Home collection" : "Centre visit"}</dd></div>{row.collectionAddress && <div><dt>Requested address</dt><dd>{[row.collectionAddress.line1, row.collectionAddress.line2, row.collectionAddress.city, row.collectionAddress.state, row.collectionAddress.postalCode].filter(Boolean).join(", ")}</dd></div>}</dl>}{row.category === "SUPPORT" && <p>This is an internal service-review request, not a clinical support channel. Do not use it for urgent health concerns.</p>}<p>{row.message}</p><dl className="lead-details"><div><dt>Phone</dt><dd>{row.phone ?? "Not provided"}</dd></div><div><dt>Email</dt><dd>{row.email ?? "Not provided"}</dd></div><div><dt>Response request</dt><dd>{row.responsePermission ? "Requested; contact permission remains pending staff review" : "Not requested"}</dd></div></dl>
      {row.status !== "PENDING_REVIEW" && <p>This enquiry is {row.status.replaceAll("_", " ").toLowerCase()}; review actions are unavailable. Its history remains with the originating workflow.</p>}
      {row.status === "PENDING_REVIEW" && canCreate && row.category !== "SUPPORT" && <div className="task-actions"><label>Assign new CRM lead to<select defaultValue={staffId} id={`public-enquiry-assignee-${row.id}`}>{assignees.map((assignee) => <option value={assignee.id} key={assignee.id}>{assignee.displayName} ({assignee.staffCode})</option>)}</select></label><button className="button button-primary" disabled={busyId === row.id} onClick={() => { const selected = document.getElementById(`public-enquiry-assignee-${row.id}`) as HTMLSelectElement | null; void review(row, "CONVERT_TO_LEAD", { assignedStaffId: canAssign ? selected?.value ?? staffId : staffId }); }}>Create CRM lead</button></div>}
      {row.status === "PENDING_REVIEW" && row.category === "SUPPORT" && <p>Keep this item in the support review queue; it cannot be converted into a sales CRM lead.</p>}
      {row.status === "PENDING_REVIEW" && row.requestKind === "INQUIRY" && ["CORPORATE", "PARTNER"].includes(row.requestTopic ?? "") && relationshipGrants.some((grant) => grant.key === (row.requestTopic === "CORPORATE" ? "corporate.manage" : "partners.manage") && (grant.centreId === null || grant.centreId === row.centreId)) && <div className="task-actions"><button className="button button-secondary" disabled={busyId === row.id || !row.responsePermission || !row.organizationName?.trim()} onClick={() => void review(row, "CONVERT_TO_RELATIONSHIP", {})}>Create inactive relationship profile</button><small>Requires a requested response and organization name. The profile stays inactive with agreement status Not recorded; this does not authorize contact, activate a partnership or grant patient access.</small></div>}
      {row.status === "PENDING_REVIEW" && canCreateSupportFollowupAtCentre(taskGrants, row.centreId) && <div className="task-actions"><button className="button button-secondary" disabled={busyId === row.id} onClick={() => void createFollowup(row)}>Create internal review task</button><small>Creates a centre-scoped task with an encrypted enquiry reference. Contact details are not copied; this action does not authorize contact.</small></div>}
      {row.status === "PENDING_REVIEW" && canDismiss && <div className="task-actions"><label>Dismissal reason<input value={reason[row.id] ?? ""} maxLength={240} onChange={(event) => setReason((previous) => ({ ...previous, [row.id]: event.target.value }))}/></label><button className="button button-secondary" disabled={busyId === row.id || (reason[row.id] ?? "").trim().length < 3} onClick={() => void review(row, "DISMISS", { reason: reason[row.id]?.trim() })}>Dismiss enquiry</button></div>}
    </article>)}<p role="status" aria-live="polite">{state}</p>{!selectedEnquiryId && <nav className="task-pagination" aria-label="Public enquiry review pages"><button type="button" className="button button-secondary" disabled={page <= 1 || busyId !== null} onClick={() => void load(centreId, page - 1)}>Previous</button><span>Page {page}</span><button type="button" className="button button-secondary" disabled={!hasMore || busyId !== null} onClick={() => void load(centreId, page + 1)}>Next</button></nav>}<button className="button button-secondary" onClick={() => void load(centreId, page, selectedEnquiryId)} disabled={!centreId || busyId !== null}>Refresh</button></section>;
}
