"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { IdempotencyAttempt } from "@/lib/idempotency-attempt";

type FieldException = {
  centreId: string;
  exceptionType: string;
  exceptionStatus: string;
  recordedAt: string;
  specimenNumber: string;
  specimenStatus: string;
};
type EligibleSpecimen = { centreId: string; specimenNumber: string; specimenStatus: string; versionNumber: number; collectedAt: string };

export function FieldExceptionQueue() {
  const [items, setItems] = useState<FieldException[]>([]);
  const [eligible, setEligible] = useState<EligibleSpecimen[]>([]);
  const [state, setState] = useState("Loading assigned exceptions…");
  const [actionMessage, setActionMessage] = useState("");
  const [busySpecimen, setBusySpecimen] = useState<string | null>(null);
  const attempts = useRef(new Map<string, IdempotencyAttempt>());

  const refresh = useCallback(async () => {
    setState("Loading assigned exceptions…");
    try {
      const response = await fetch("/api/field/exceptions", { cache: "no-store" });
      const body: unknown = await response.json();
      if (!response.ok || !body || typeof body !== "object" || !Array.isArray((body as { exceptions?: unknown }).exceptions) || !Array.isArray((body as { eligibleSpecimens?: unknown }).eligibleSpecimens)) {
        setItems([]);
        setEligible([]);
        setState(response.status === 403 ? "This queue is not available for your role or centre." : "Assigned exceptions could not be loaded.");
        return;
      }
      setItems((body as { exceptions: FieldException[] }).exceptions);
      setEligible((body as { eligibleSpecimens: EligibleSpecimen[] }).eligibleSpecimens);
      setState("");
    } catch {
      setItems([]);
      setEligible([]);
      setState("Assigned exceptions could not be loaded. Retry when the connection is available.");
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => { void refresh(); }, 0); return () => window.clearTimeout(timer); }, [refresh]);

  async function recordException(event: React.FormEvent<HTMLFormElement>, specimen: EligibleSpecimen) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const payload = JSON.stringify({
      centreId: specimen.centreId,
      specimenNumber: specimen.specimenNumber,
      expectedVersion: specimen.versionNumber,
      type: String(form.get("type")),
      reason: String(form.get("reason")),
    });
    const attempt = attempts.current.get(specimen.specimenNumber) ?? new IdempotencyAttempt(`rudra:field-sample-exception:${specimen.centreId}:${specimen.specimenNumber}`);
    attempts.current.set(specimen.specimenNumber, attempt);
    setBusySpecimen(specimen.specimenNumber);
    setActionMessage("Recording the exception…");
    try {
      const response = await fetch("/api/field/exceptions", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": await attempt.keyFor(payload) },
        body: payload,
      });
      const body = await response.json() as { error?: string; result?: { replayed?: boolean } };
      if (!response.ok) {
        if (response.status < 500) { attempt.clear(); attempts.current.delete(specimen.specimenNumber); }
        setActionMessage(body.error === "version_conflict" ? "This specimen changed. Refresh the queue and review its current status." : body.error === "invalid_sample_transition" || body.error === "sample_already_submitted" ? "This specimen is no longer eligible for a field exception." : "The exception was not recorded. Check your access and try again.");
        return;
      }
      attempt.clear();
      attempts.current.delete(specimen.specimenNumber);
      setActionMessage(body.result?.replayed ? "The prior exception was already recorded." : "Exception recorded for centre review.");
      await refresh();
    } catch {
      setActionMessage("The exception outcome could not be confirmed. Retry the unchanged details to safely check whether it was saved.");
    } finally {
      setBusySpecimen(null);
    }
  }

  if (state) return <section className="admin-card"><p role="status" aria-live="polite">{state}</p>{state.includes("could not be loaded") ? <button className="button button-secondary" onClick={() => void refresh()}>Retry</button> : null}</section>;
  return <>
  <section className="admin-card">
    <p className="setup-notice">This list contains open exceptions from your assigned jobs only. It omits patient identity, private notes and evidence. Ask an authorized centre receiver or manager to review resolution.</p>
    <h2>Open exceptions</h2>
    {items.length ? <div className="table-scroll"><table className="admin-table"><thead><tr><th>Specimen</th><th>Exception</th><th>Specimen status</th><th>Recorded</th></tr></thead><tbody>
      {items.map((item) => <tr key={`${item.specimenNumber}:${item.recordedAt}`}><td>{item.specimenNumber}</td><td>{item.exceptionType.replaceAll("_", " ")}</td><td>{item.specimenStatus.replaceAll("_", " ")}</td><td><time dateTime={item.recordedAt}>{new Date(item.recordedAt).toLocaleString()}</time></td></tr>)}
    </tbody></table></div> : <p role="status" aria-live="polite">No open exceptions are linked to your assigned collection jobs.</p>}
  </section>
  <section className="admin-card">
    <h2>Report a specimen exception</h2>
    <p>Only collected specimens still assigned to you and not yet submitted for Rudra receiving are eligible. Record operational facts, avoid patient identifiers or medical interpretation, and send consequential decisions to an authorized reviewer.</p>
    {actionMessage ? <p role="status" aria-live="polite">{actionMessage}</p> : null}
    {eligible.length ? eligible.map((specimen) => <form key={specimen.specimenNumber} className="admin-form sample-form" onSubmit={(event) => void recordException(event, specimen)}>
      <h3>{specimen.specimenNumber} · {specimen.specimenStatus.replaceAll("_", " ")}</h3>
      <label>Exception type<select name="type" required defaultValue="MISSING_LABEL"><option value="MISSING_LABEL">Missing or incorrect label</option><option value="DAMAGED">Damage observed</option><option value="MISSING_SPECIMEN">Specimen missing</option><option value="HANDOVER_DISCREPANCY">Handover discrepancy</option><option value="OTHER">Other operational issue</option></select></label>
      <label>Operational reason<input name="reason" required minLength={3} maxLength={240} /></label>
      <button className="button button-secondary" disabled={busySpecimen === specimen.specimenNumber}>{busySpecimen === specimen.specimenNumber ? "Recording…" : "Record for centre review"}</button>
    </form>) : <p role="status" aria-live="polite">No collected specimen is currently eligible for a field exception.</p>}
  </section>
  </>;
}
