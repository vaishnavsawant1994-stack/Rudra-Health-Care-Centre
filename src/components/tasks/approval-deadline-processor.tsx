"use client";

import { useState } from "react";
import { json } from "@/lib/http";

type ProcessResult = { processed: number; expired: number; escalated: number; skippedInvalidOwner: number; limit: number };

export function ApprovalDeadlineProcessor() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function processDueItems() {
    setBusy(true);
    setMessage("Checking due task approvals in your permitted centres…");
    try {
      const { response, body } = await json<ProcessResult | { error?: string }>("/api/tasks/approvals/process-due", { method: "POST" });
      if (!response.ok || !("processed" in body)) {
        setMessage("Due approvals could not be processed. Refresh the queue and try again.");
        return;
      }
      setMessage(`${body.processed} due item${body.processed === 1 ? "" : "s"} processed: ${body.expired} expired, ${body.escalated} escalated${body.skippedInvalidOwner ? `, ${body.skippedInvalidOwner} skipped for an invalid escalation owner` : ""}. This action does not approve or reject tasks.`);
    } catch {
      setMessage("The approval service is unavailable. Refresh the queue and try again.");
    } finally {
      setBusy(false);
    }
  }

  return <section className="admin-card" aria-labelledby="approval-deadline-title">
    <h2 id="approval-deadline-title">Due approval checks</h2>
    <p>Run expiry and escalation checks for task-completion approvals in your authorized centres. This does not approve or reject a task.</p>
    <button type="button" className="button button-secondary" disabled={busy} onClick={() => void processDueItems()}>{busy ? "Processing due items…" : "Process due approvals now"}</button>
    <p role="status" aria-live="polite">{message}</p>
  </section>;
}
