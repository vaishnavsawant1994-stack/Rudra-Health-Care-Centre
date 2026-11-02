"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { PatientCollectionHistory } from "@/components/samples/sample-workbench";
import { saveAppointmentPatientSelection } from "@/lib/appointment-patient-selection";

type Centre = { id: string; code: string; name: string };
type PatientRow = { id: string; patientNumber: string; firstName: string; lastName: string; preferredName: string | null; centreId: string; createdAt: string };
type PatientProfile = PatientRow & { dateOfBirth: string; sexAtRegistration: string | null; phone: string; email: string | null; address: Record<string, string> | null; consentStatus: string; consentMethod: string | null; consentRecordedAt: string | null };
type Activity = { action: string; recordedAt: string };
type PatientFamilyMembership = { familyId: string; familyNumber: string; displayName: string; relationship: string; status: string; primaryContact: string | null };

export function PatientAppointmentLink({ patientId }: { patientId: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  return <span><button type="button" className="button button-primary" onClick={() => {
    try { saveAppointmentPatientSelection(window.sessionStorage, { patientId }); router.push("/appointments/new"); }
    catch { setMessage("Could not prepare the appointment handoff in this tab. Open New booking and search for this patient."); }
  }}>Request appointment</button>{message ? <small role="status">{message}</small> : null}</span>;
}

async function getJson<T>(url: string): Promise<{ response: Response; body: T }> {
  const response = await fetch(url, { cache: "no-store" });
  return { response, body: await response.json() as T };
}

export function PatientList({ canCreate = false }: { canCreate?: boolean } = {}) {
  const [rows, setRows] = useState<PatientRow[]>([]);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [centreId, setCentreId] = useState("");
  const [query, setQuery] = useState("");
  const [state, setState] = useState("Loading patient records…");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (search = query, centre = centreId) => {
    setBusy(true); setState("Loading patient records…");
    try {
      const response = await fetch("/api/patients/search", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ q: search.trim(), centreId: centre || null }) });
      const body = await response.json() as { patients?: PatientRow[]; error?: string };
      if (!response.ok) { setState(body.error === "authentication_required" ? "Sign in to view patient records." : body.error === "forbidden" ? "You do not have permission for this patient scope." : "Patient records are unavailable. Try again."); setRows([]); return; }
      setRows(body.patients ?? []); setState(body.patients?.length ? "" : "No patients found in your authorized centre scope.");
    } catch { setRows([]); setState("Patient service is unavailable. Try again."); }
    finally { setBusy(false); }
  }, [centreId, query]);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const [centreResult, patientResult] = await Promise.all([
          getJson<{ centres?: Centre[] }>("/api/patients/centres?purpose=read"),
          getJson<{ patients?: PatientRow[]; error?: string }>("/api/patients"),
        ]);
        if (!live) return;
        if (centreResult.response.ok) setCentres(centreResult.body.centres ?? []);
        if (!patientResult.response.ok) { setState(patientResult.body.error === "authentication_required" ? "Sign in to view patient records." : "Patient records are unavailable. Try again."); return; }
        const patientsResult = patientResult.body.patients ?? [];
        setRows(patientsResult); setState(patientsResult.length ? "" : "No patients found in your authorized centre scope.");
      } catch { if (live) setState("Patient service is unavailable. Try again."); }
    })();
    return () => { live = false; };
  }, []);

  function search(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void load(query, centreId); }

  return <>
    <section className="admin-card patient-toolbar">
      <div><h2>Patient records</h2><p>Only records in your authorized Rudra centre scope are shown.</p></div>
      {canCreate ? <Link className="button button-primary" href="/patients/new">Register patient</Link> : null}
      <form className="admin-form patient-search" onSubmit={search}>
        <label>Search exact patient name, ID substring or exact phone<input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={80} autoComplete="off" /></label>
        <label>Centre<select value={centreId} onChange={(event) => { setCentreId(event.target.value); void load(query, event.target.value); }}><option value="">All authorized centres</option>{centres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name} ({centre.code})</option>)}</select></label>
        <button className="button button-secondary" disabled={busy}>{busy ? "Searching…" : "Search"}</button>
      </form>
      {state ? <p role="status">{state}<button type="button" className="text-button" onClick={() => void load()} disabled={busy}>Retry</button></p> : null}
      {rows.length ? <div className="table-scroll"><table className="admin-table"><thead><tr><th>Patient ID</th><th>Patient</th><th>Centre</th><th>Created</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.patientNumber}</td><td><Link href={`/patients/${row.id}`}>{row.preferredName || row.firstName} {row.lastName}</Link></td><td>{centres.find((centre) => centre.id === row.centreId)?.name ?? "Authorized centre"}</td><td>{new Date(row.createdAt).toLocaleDateString()}</td></tr>)}</tbody></table></div> : null}
    </section>
  </>;
}

export function PatientRegistrationForm({ initialCentreId, continueWalkIn = false }: { initialCentreId?: string; continueWalkIn?: boolean } = {}) {
  const router = useRouter();
  const [centres, setCentres] = useState<Centre[]>([]);
  const [message, setMessage] = useState("Loading authorized centres…");
  const [created, setCreated] = useState<PatientRow | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => { let live = true; void getJson<{ centres?: Centre[]; error?: string }>("/api/patients/centres").then(({ response, body }) => { if (!live) return; const available = body.centres ?? []; setCentres(available); setMessage(response.ok ? available.length ? "" : "No authorized active centre is available for registration." : "Centre setup is unavailable. Check your patient creation permission."); }).catch(() => { if (live) setMessage("Centre service is unavailable."); }); return () => { live = false; }; }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); setPending(true); setMessage(""); setCreated(null);
    const body: Record<string, unknown> = Object.fromEntries(data.entries());
    for (const key of ["preferredName", "email", "line1", "line2", "city", "state", "postalCode"]) if (body[key] === "") body[key] = null;
    body.address = ["line1", "line2", "city", "state", "postalCode"].some((key) => body[key]) ? Object.fromEntries(["line1", "line2", "city", "state", "postalCode"].filter((key) => body[key]).map((key) => [key, body[key]])) : null;
    for (const key of ["line1", "line2", "city", "state", "postalCode"]) delete body[key];
    try {
      const response = await fetch("/api/patients", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) { setMessage(result.error === "possible_duplicate_review_required" ? "A possible duplicate exists in this centre. Ask an authorized staff member to review before registering." : result.error === "forbidden" ? "You are not authorized to register at that centre." : "Patient was not registered. Check the fields and try again."); return; }
      setCreated(result.patient); setMessage("Patient registered. The patient ID is ready."); form.reset();
      if (continueWalkIn) {
        try {
          saveAppointmentPatientSelection(window.sessionStorage, { patientId: result.patient.id, centreId: String(body.centreId) });
          router.push(`/appointments/new?source=WALK_IN&centreId=${encodeURIComponent(String(body.centreId))}`);
        } catch {
          setMessage("Patient is registered, but the walk-in handoff could not be saved in this tab. Return to booking and search for this patient.");
        }
      }
    } catch { setMessage("Patient service is unavailable. No success was recorded."); }
    finally { setPending(false); }
  }

  return <section className="admin-card"><p>Use synthetic records only in this development environment. Patient fields are not written to application logs.</p>
    {message && !centres.length ? <p role="status">{message}</p> : null}
    {centres.length ? <form className="admin-form patient-form" onSubmit={submit}>
      <label>Centre<select name="centreId" required defaultValue={initialCentreId ?? ""}><option value="" disabled>Select centre</option>{centres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name} ({centre.code})</option>)}</select></label>
      <label>First name<input name="firstName" required maxLength={100} autoComplete="given-name" /></label>
      <label>Last name<input name="lastName" required maxLength={100} autoComplete="family-name" /></label>
      <label>Preferred name<input name="preferredName" maxLength={100} autoComplete="off" /></label>
      <label>Date of birth<input name="dateOfBirth" type="date" required max={new Date().toISOString().slice(0, 10)} /></label>
      <label>Sex at registration<select name="sexAtRegistration" defaultValue="UNSPECIFIED"><option value="UNSPECIFIED">Unspecified</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="INTERSEX">Intersex</option></select></label>
      <label>Phone<input name="phone" type="tel" required minLength={7} maxLength={32} autoComplete="tel" /></label>
      <label>Email<input name="email" type="email" maxLength={254} autoComplete="email" /></label>
      <fieldset className="patient-address"><legend>Address (optional)</legend><label>Address line 1<input name="line1" maxLength={160} autoComplete="address-line1" /></label><label>Address line 2<input name="line2" maxLength={160} autoComplete="address-line2" /></label><label>City<input name="city" maxLength={100} autoComplete="address-level2" /></label><label>State<input name="state" maxLength={100} autoComplete="address-level1" /></label><label>Postal code<input name="postalCode" maxLength={16} autoComplete="postal-code" /></label></fieldset>
      <label>Consent status<select name="consentStatus" required defaultValue="NOT_RECORDED"><option value="NOT_RECORDED">Not recorded</option><option value="GRANTED">Granted</option><option value="DECLINED">Declined</option></select></label>
      <label>Consent method (only if recorded)<select name="consentMethod" defaultValue=""><option value="">Not recorded</option><option value="IN_PERSON">In person</option><option value="PHONE">Phone</option><option value="ONLINE">Online</option><option value="WRITTEN">Written</option></select></label>
      <p role="note">This records the stated consent status and method; it does not determine legal basis or replace approved consent wording.</p>
      <button className="button button-primary" disabled={pending}>{pending ? "Registering…" : "Register patient"}</button>
      <p role="status" aria-live="polite">{message}</p>
      {created ? <p>Patient ID: <Link href={`/patients/${created.id}`}>{created.patientNumber} — open Patient 360°</Link></p> : null}
    </form> : null}
  </section>;
}

export function PatientProfile({ patientId, canReadOrders = false, canCreateOrder = false, canReadSamples = false }: { patientId: string; canReadOrders?: boolean; canCreateOrder?: boolean; canReadSamples?: boolean }) {
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [activity, setActivity] = useState<Activity[]>([]);
  const [orders, setOrders] = useState<Array<{ id: string; orderNumber: string; status: string; totalAmount: string | null; currency: string; createdAt: string }>>([]);
  const [ordersState, setOrdersState] = useState("Loading order history…");
  const [family, setFamily] = useState<Array<{ id: string; relationship: string; patient: { id: string; patientNumber: string; name: string } }>>([]);
  const [families, setFamilies] = useState<PatientFamilyMembership[]>([]);
  const [state, setState] = useState("Loading authorized patient profile…");
  const load = useCallback(() => { void getJson<{ patient?: PatientProfile; activity?: Activity[]; familyRelationships?: typeof family; familyMemberships?: PatientFamilyMembership[]; error?: string }>(`/api/patients/${patientId}`).then(({ response, body }) => { if (!response.ok || !body.patient) { setProfile(null); setState(response.status === 404 ? "Patient record not found in your authorized scope." : "Patient profile is unavailable."); return; } setProfile(body.patient); setActivity(body.activity ?? []); setFamily(body.familyRelationships ?? []); setFamilies(body.familyMemberships ?? []); setState(""); }).catch(() => setState("Patient service is unavailable.")); }, [patientId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!canReadOrders) return; let live = true; void fetch("/api/orders/patient-history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ patientId }) }).then(async (response) => ({ response, body: await response.json() as { orders?: typeof orders } })).then(({ response, body }) => { if (!live) return; setOrders(response.ok ? body.orders ?? [] : []); setOrdersState(response.ok ? body.orders?.length ? "" : "No diagnostic orders yet." : "Order history is unavailable in your authorized scope."); }).catch(() => { if (live) setOrdersState("Order history is unavailable."); }); return () => { live = false; }; }, [patientId, canReadOrders]);
  if (!profile) return <section className="admin-card"><p role="status">{state}</p><button className="button button-secondary" onClick={load}>Retry</button></section>;
  const address = profile.address ? Object.values(profile.address).filter(Boolean).join(", ") : "Not recorded";
  return <>
    <section className="admin-card"><div className="patient-profile-heading"><div><p className="eyebrow">{profile.patientNumber}</p><h2>{profile.preferredName || profile.firstName} {profile.lastName}</h2></div><div className="lead-actions"><Link className="button button-secondary" href={`/patients/${patientId}/edit`}>Edit patient</Link>{canCreateOrder && <Link className="button button-primary" href="/orders/new">Create diagnostic order</Link>}</div></div>
      <dl className="patient-details"><div><dt>Date of birth</dt><dd>{profile.dateOfBirth}</dd></div><div><dt>Sex at registration</dt><dd>{profile.sexAtRegistration || "Unspecified"}</dd></div><div><dt>Phone</dt><dd>{profile.phone}</dd></div><div><dt>Email</dt><dd>{profile.email || "Not recorded"}</dd></div><div><dt>Address</dt><dd>{address}</dd></div><div><dt>Consent status</dt><dd>{profile.consentStatus === "NOT_RECORDED" ? "Not recorded" : `${profile.consentStatus} · ${profile.consentMethod?.replaceAll("_", " ").toLowerCase() ?? "Method missing"}`}</dd></div><div><dt>Consent recorded</dt><dd>{profile.consentRecordedAt ? new Date(profile.consentRecordedAt).toLocaleString() : "Not recorded"}</dd></div></dl>
    </section>
    <section className="admin-card"><h2>Diagnostic order history</h2>{(canReadOrders ? ordersState : "Order history permission is not assigned.") && <p role="status">{canReadOrders ? ordersState : "Order history permission is not assigned."}</p>}{orders.length > 0 && <div className="table-scroll"><table className="admin-table"><thead><tr><th>Order</th><th>Status</th><th>Total</th><th>Created</th></tr></thead><tbody>{orders.map((order) => <tr key={order.id}><td><Link href={`/orders/${order.id}`}>{order.orderNumber}</Link></td><td>{order.status}</td><td>{order.totalAmount === null ? "Not confirmed" : `₹${order.totalAmount} ${order.currency}`}</td><td>{new Date(order.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div>}</section>
    {canReadSamples ? <PatientCollectionHistory patientId={patientId} /> : null}
    <section className="admin-card"><h2>Family relationships</h2>{family.length ? <ul>{family.map((link) => <li key={link.id}>{link.relationship.toLowerCase()} · <Link href={`/patients/${link.patient.id}`}>{link.patient.name} ({link.patient.patientNumber})</Link></li>)}</ul> : <p>No confirmed family relationships are linked. Adult records require their own authorization; a family link does not grant access.</p>}</section>
    {families.length ? <section className="admin-card"><h2>Family membership</h2><ul>{families.map((membership) => <li key={membership.familyId}><Link href={`/families/${membership.familyId}`}>{membership.displayName} ({membership.familyNumber})</Link> · {membership.relationship.toLowerCase()} · {membership.status.replaceAll("_", " ").toLowerCase()}</li>)}</ul><p>Membership is administrative. It does not authorize access to another person’s patient record.</p></section> : null}
    <section className="admin-card"><h2>Patient activity</h2>{activity.length ? <ol className="patient-timeline">{activity.map((event, index) => <li key={`${event.action}-${event.recordedAt}-${index}`}><strong>{event.action.replaceAll("patient.", "Patient ").replaceAll("_", " ")}</strong><time dateTime={event.recordedAt}>{new Date(event.recordedAt).toLocaleString()}</time></li>)}</ol> : <p>No activity events are recorded yet.</p>}</section>
  </>;
}

export function PatientEditForm({ patientId }: { patientId: string }) {
  const [profile, setProfile] = useState<PatientProfile | null>(null); const [message, setMessage] = useState("Loading patient details…"); const [pending, setPending] = useState(false);
  useEffect(() => { let live = true; void getJson<{ patient?: PatientProfile }>(`/api/patients/${patientId}`).then(({ response, body }) => { if (!live) return; if (!response.ok || !body.patient) setMessage("Patient record not found in your authorized scope."); else { setProfile(body.patient); setMessage(""); } }).catch(() => { if (live) setMessage("Patient service is unavailable."); }); return () => { live = false; }; }, [patientId]);
  async function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); const body: Record<string, unknown> = Object.fromEntries(data.entries()); for (const key of Object.keys(body)) if (body[key] === "") body[key] = null; body.address = ["line1", "line2", "city", "state", "postalCode"].some((key) => body[key]) ? Object.fromEntries(["line1", "line2", "city", "state", "postalCode"].filter((key) => body[key]).map((key) => [key, body[key]])) : null; for (const key of ["line1", "line2", "city", "state", "postalCode"]) delete body[key]; setPending(true); setMessage(""); try { const response = await fetch(`/api/patients/${patientId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) { setMessage(result.error === "possible_duplicate_review_required" ? "A possible duplicate exists in this centre. Ask an authorized staff member to review." : "Patient update was not saved. Check permission and fields."); return; } setMessage("Patient profile saved."); } catch { setMessage("Patient service is unavailable. No success was recorded."); } finally { setPending(false); } }
  if (!profile) return <section className="admin-card"><p role="status">{message}</p></section>;
  return <section className="admin-card"><p>Updating {profile.patientNumber}. All changes are audit recorded; patient values are excluded from audit details and application logs.</p><form className="admin-form patient-form" onSubmit={submit}>
    <label>First name<input name="firstName" required maxLength={100} defaultValue={profile.firstName} /></label><label>Last name<input name="lastName" required maxLength={100} defaultValue={profile.lastName} /></label><label>Preferred name<input name="preferredName" maxLength={100} defaultValue={profile.preferredName ?? ""} /></label><label>Date of birth<input name="dateOfBirth" type="date" required max={new Date().toISOString().slice(0, 10)} defaultValue={profile.dateOfBirth} /></label><label>Sex at registration<select name="sexAtRegistration" defaultValue={profile.sexAtRegistration || "UNSPECIFIED"}><option value="UNSPECIFIED">Unspecified</option><option value="FEMALE">Female</option><option value="MALE">Male</option><option value="INTERSEX">Intersex</option></select></label><label>Phone<input name="phone" type="tel" required minLength={7} maxLength={32} defaultValue={profile.phone} /></label><label>Email<input name="email" type="email" maxLength={254} defaultValue={profile.email ?? ""} /></label>
    <fieldset className="patient-address"><legend>Address</legend><label>Address line 1<input name="line1" maxLength={160} defaultValue={profile.address?.line1 ?? ""} /></label><label>Address line 2<input name="line2" maxLength={160} defaultValue={profile.address?.line2 ?? ""} /></label><label>City<input name="city" maxLength={100} defaultValue={profile.address?.city ?? ""} /></label><label>State<input name="state" maxLength={100} defaultValue={profile.address?.state ?? ""} /></label><label>Postal code<input name="postalCode" maxLength={16} defaultValue={profile.address?.postalCode ?? ""} /></label></fieldset>
    <label>Consent status<select name="consentStatus" defaultValue={profile.consentStatus}><option value="NOT_RECORDED">Not recorded</option><option value="GRANTED">Granted</option><option value="DECLINED">Declined</option><option value="WITHDRAWN">Withdrawn</option></select></label><label>Consent method (only if recorded)<select name="consentMethod" defaultValue={profile.consentMethod ?? ""}><option value="">Not recorded</option><option value="IN_PERSON">In person</option><option value="PHONE">Phone</option><option value="ONLINE">Online</option><option value="WRITTEN">Written</option></select></label>
    <button className="button button-primary" disabled={pending}>{pending ? "Saving…" : "Save patient changes"}</button><p role="status" aria-live="polite">{message}</p>
  </form></section>;
}
