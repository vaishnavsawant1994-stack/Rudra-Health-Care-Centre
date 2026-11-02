"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { IdempotencyAttempt } from "@/lib/idempotency-attempt";
import { canCreateStaffTaskAtCentre } from "@/lib/staff-task-access";
import type { PermissionGrant } from "@/server/permissions";

type Centre = { id: string; code: string; name: string };
type Doctor = { id: string; centreId: string; doctorNumber: string; name: string; specialty: string; status: "ACTIVE" | "INACTIVE" };
type Visit = { id: string; scheduledAt: string | null; purpose: string; agenda: string | null; checkedInAt: string | null; summary: string | null; followUp: string | null; cancelled: string | null; events: Array<{ type: string; actorStaffId: string; recordedAt: string }> };

export function DoctorVisitWorkbench({ grants = [] }: { grants?: PermissionGrant[] }) {
  const attempts = useRef(new Map<string, IdempotencyAttempt>());
  const [centres, setCentres] = useState<Centre[]>([]); const [centreId, setCentreId] = useState("");
  const [doctors, setDoctors] = useState<Doctor[]>([]); const [doctorId, setDoctorId] = useState("");
  const [visits, setVisits] = useState<Visit[]>([]); const [visitPage, setVisitPage] = useState(1); const [visitsHaveMore, setVisitsHaveMore] = useState(false); const [message, setMessage] = useState("Loading authorized centres…"); const [busy, setBusy] = useState(false);
  const doctor = doctors.find((item) => item.id === doctorId);

  async function loadDoctors(scope: string) {
    if (!scope) return;
    setMessage("Loading authorized doctor relationships…");
    try {
      const response = await fetch(`/api/doctors?centreId=${encodeURIComponent(scope)}&status=ACTIVE&pageSize=50`, { cache: "no-store" });
      const body = await response.json() as { doctors?: Doctor[] };
      if (!response.ok) throw Error();
      setDoctors(body.doctors ?? []); setDoctorId(""); setVisits([]);
      setMessage(body.doctors?.length ? "" : "No active doctor relationships are available in this centre.");
    } catch { setDoctors([]); setDoctorId(""); setVisits([]); setMessage("Doctor relationships could not be loaded for this centre."); }
  }

  async function loadHistory(selected: Doctor, page = 1) {
    setMessage("Loading visit history…");
    try {
      const response = await fetch(`/api/doctors/${selected.id}/visits?centreId=${encodeURIComponent(selected.centreId)}&page=${page}&pageSize=100`, { cache: "no-store" });
      const body = await response.json() as { visits?: Visit[]; hasMore?: boolean };
      if (!response.ok) throw Error();
      setVisits(body.visits ?? []); setVisitPage(page); setVisitsHaveMore(body.hasMore === true);
      setMessage("");
    } catch { setVisits([]); setMessage("Visit history is unavailable in your current centre scope."); }
  }

  useEffect(() => { let active = true; void fetch("/api/doctors/centres", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json() as { centres?: Centre[] } })).then(({ response, body }) => { if (!active) return; if (!response.ok) throw Error(); setCentres(body.centres ?? []); const first = body.centres?.[0]; if (first) { setCentreId(first.id); void loadDoctors(first.id); } else setMessage("No centre is available in your permission scope."); }).catch(() => { if (active) setMessage("Centre access could not be loaded."); }); return () => { active = false; }; }, []);
  async function submitAction(action: "PLAN" | "CHECK_IN" | "RECORD" | "CANCEL", visit?: Visit, formElement?: HTMLFormElement) {
    if (!doctor) return;
    const form = formElement ? new FormData(formElement) : new FormData();
    const bodyValue = action === "PLAN"
      ? { action, centreId, scheduledAt: new Date(String(form.get("scheduledAt"))).toISOString(), purpose: form.get("purpose"), agenda: form.get("agenda") || null }
      : action === "CHECK_IN" ? { action, centreId, visitId: visit?.id }
        : action === "RECORD" ? { action, centreId, visitId: visit?.id, summary: form.get("summary"), followUp: form.get("followUp") || null }
          : { action, centreId, visitId: visit?.id, reason: form.get("reason") };
    const body = JSON.stringify(bodyValue); const scope = `${action}:${centreId}:${doctor.id}:${visit?.id ?? "new"}`;
    let attempt = attempts.current.get(scope); if (!attempt) { attempt = new IdempotencyAttempt(`rudra:doctor-visit:${scope}`); attempts.current.set(scope, attempt); }
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/doctors/${doctor.id}/visits`, { method: "POST", headers: { "content-type": "application/json", "idempotency-key": await attempt.keyFor(body) }, body });
      const result = await response.json() as { error?: string };
      if (!response.ok) { if (response.status < 500) { attempt.clear(); attempts.current.delete(scope); } setMessage(result.error === "visit_must_be_scheduled_in_future" ? "Choose a future visit time." : result.error === "visit_check_in_required" ? "Record check-in before adding the meeting summary." : "The visit action was not completed. Check your permission and visit state."); return; }
      attempt.clear(); attempts.current.delete(scope); setMessage("Visit history updated.");
      if (formElement && action === "PLAN") formElement.reset();
      await loadHistory(doctor, 1);
    } catch { setMessage("The result could not be confirmed. Retry the unchanged action to check its idempotent result."); }
    finally { setBusy(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>, action: "PLAN" | "CHECK_IN" | "RECORD" | "CANCEL", visit?: Visit) {
    event.preventDefault(); void submitAction(action, visit, event.currentTarget);
  }

  return <div className="admin-grid">
    <section className="admin-card">
      <h2>Plan a doctor relationship visit</h2>
      <p>Use synthetic operational notes only. Do not include patient names, health information, referral payments, or location tracking. Check-in is a staff-recorded action, not GPS verification.</p>
      <label>Centre<select value={centreId} onChange={(event) => { setCentreId(event.target.value); setDoctorId(""); setVisits([]); void loadDoctors(event.target.value); }}><option value="">Select centre</option>{centres.map((item) => <option key={item.id} value={item.id}>{item.name} / {item.code}</option>)}</select></label>
      <label>Doctor<select value={doctorId} onChange={(event) => { const selected = doctors.find((item) => item.id === event.target.value); setDoctorId(event.target.value); setVisits([]); if (selected) void loadHistory(selected, 1); }}><option value="">Select doctor</option>{doctors.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.specialty} · {item.doctorNumber}</option>)}</select></label>
      {doctor ? <form className="admin-form" onSubmit={(event) => void submit(event, "PLAN")}>
        <label>Planned date and time<input name="scheduledAt" type="datetime-local" required /></label>
        <label>Purpose<select name="purpose"><option value="RELATIONSHIP">Relationship meeting</option><option value="SERVICE_OVERVIEW">Service overview</option><option value="FOLLOW_UP">Follow-up</option><option value="OTHER">Other</option></select></label>
        <label>Operational agenda<textarea name="agenda" maxLength={500} rows={3} /></label>
        <button className="button button-primary" disabled={busy}>Plan visit</button>
      </form> : <p>Select an authorized doctor to plan and review field visits.</p>}
      <p role="status">{message}</p>
    </section>
    {doctor ? <section className="admin-card">
      <h2>Visit plan and field log</h2>
      {visits.length === 0 ? <p>No visits recorded for this doctor.</p> : <div className="table-scroll"><table><thead><tr><th>Scheduled</th><th>Purpose and agenda</th><th>Status/history</th><th>Action</th></tr></thead><tbody>{visits.map((visit) => <tr key={visit.id}>
        <td>{visit.scheduledAt ? new Date(visit.scheduledAt).toLocaleString() : "—"}</td><td>{visit.purpose}{visit.agenda ? <p>{visit.agenda}</p> : null}</td>
        <td>{visit.cancelled ? `Cancelled: ${visit.cancelled}` : visit.summary ? <><strong>Meeting recorded</strong><p>{visit.summary}</p>{visit.followUp ? <p>Follow-up: {visit.followUp}</p> : null}</> : visit.checkedInAt ? `Checked in ${new Date(visit.checkedInAt).toLocaleString()}` : "Planned"}<ul>{visit.events.map((item, index) => <li key={`${item.type}-${item.recordedAt}-${index}`}>{item.type.replaceAll("_", " ")} · {new Date(item.recordedAt).toLocaleString()}</li>)}</ul></td>
        <td>{visit.followUp && canCreateStaffTaskAtCentre(grants, doctor.centreId) ? <p><Link className="text-button" href={`/tasks?centreId=${encodeURIComponent(doctor.centreId)}&referenceType=DOCTOR_RELATIONSHIP&referenceId=${encodeURIComponent(doctor.id)}&taskType=FOLLOW_UP`}>Create linked staff follow-up task</Link></p> : null}{!visit.summary && !visit.cancelled ? <>
          {!visit.checkedInAt ? <><button type="button" className="button button-secondary" disabled={busy} onClick={() => void submitAction("CHECK_IN", visit)}>Record check-in</button><form className="admin-form" onSubmit={(event) => submit(event, "CANCEL", visit)}><label>Cancellation reason<input name="reason" minLength={2} maxLength={400} required /></label><button className="button button-secondary" disabled={busy}>Cancel planned visit</button></form></> : <form className="admin-form" onSubmit={(event) => submit(event, "RECORD", visit)}><label>Meeting summary<textarea name="summary" minLength={2} maxLength={1200} rows={3} required /></label><label>Operational follow-up note<textarea name="followUp" maxLength={600} rows={2} /></label><button className="button button-primary" disabled={busy}>Record meeting</button></form>}
        </> : "Closed"}</td>
      </tr>)}</tbody></table></div>}
      <h3>Append-only visit history</h3><p>Planned dates, staff-recorded check-ins, meeting records and cancellations are retained as separate encrypted events. A follow-up note is recorded here; it does not create or send a patient task/message.</p>
      <div className="task-toolbar"><button type="button" className="button button-secondary" disabled={busy || visitPage <= 1} onClick={() => void loadHistory(doctor, visitPage - 1)}>Previous</button><span>Page {visitPage}</span><button type="button" className="button button-secondary" disabled={busy || !visitsHaveMore} onClick={() => void loadHistory(doctor, visitPage + 1)}>Next</button></div>
    </section> : null}
  </div>;
}
