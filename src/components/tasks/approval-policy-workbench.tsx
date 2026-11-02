"use client";

import { useEffect, useRef, useState } from "react";
import { IdempotencyAttempt } from "@/lib/idempotency-attempt";

type Centre = { id: string; code: string; name: string };
type Approver = { id: string; displayName: string; staffCode: string };
type Policy = { id: string; centreId: string | null; actionType: "TASK_COMPLETION"; enabled: boolean; approverPermission: string; approverStaffIds: string[]; escalationAfterMinutes: number | null; escalationOwnerStaffId: string | null; expireAfterMinutes: number | null; versionNumber: number };
type EffectivePolicy = { source: "CENTRE" | "ORGANIZATION" | "NONE"; enabled: boolean };
type DirectoryPolicy = { id: string | null; centreId: string | null; centreName: string | null; centreCode: string | null; actionType: "TASK_COMPLETION"; enabled: boolean; configured: boolean; versionNumber: number | null; escalationAfterMinutes: number | null; expireAfterMinutes: number | null; updatedAt: string | null };
type PolicyHistoryEntry = { sequence: string; action: string; actorDisplayName: string; recordedAt: string; snapshotComplete: boolean; version: number | null; enabled: boolean | null; approverDisplayNames: string[] | null; escalationAfterMinutes: number | null; escalationOwnerDisplayName: string | null; expireAfterMinutes: number | null };
async function read<T>(response: Response) { return response.json().catch(() => ({})) as Promise<T>; }

export function ApprovalPolicyWorkbench({ sessionStaffId }: { sessionStaffId: string }) {
  function selectScope(id: string) { setCentreId(id); setHistoryBefore(null); setHistoryCursors([null]); setHistoryBusy(true); setPolicy(null); setEffectivePolicy(null); setEnabled(false); setApproverIds([]); setEscalationMinutes(""); setEscalationOwner(""); setExpiryMinutes(""); setPolicyLoading(true); setMessage("Loading approval policy…"); }
  const [history, setHistory] = useState<PolicyHistoryEntry[]>([]); const [historyMessage, setHistoryMessage] = useState("Loading policy history...");
  const [historyBefore, setHistoryBefore] = useState<string | null>(null); const [historyNextBefore, setHistoryNextBefore] = useState<string | null>(null); const [historyHasMore, setHistoryHasMore] = useState(false); const [historyCursors, setHistoryCursors] = useState<(string | null)[]>([null]); const [historyBusy, setHistoryBusy] = useState(false);
  const [centres, setCentres] = useState<Centre[]>([]); const [centreId, setCentreId] = useState(""); const [staff, setStaff] = useState<Approver[]>([]);
  const [directory, setDirectory] = useState<DirectoryPolicy[]>([]); const [directoryMessage, setDirectoryMessage] = useState("Loading authorized policy scopes…");
  const [policy, setPolicy] = useState<Policy | null>(null); const [enabled, setEnabled] = useState(false); const [approverIds, setApproverIds] = useState<string[]>([]); const [escalationMinutes, setEscalationMinutes] = useState(""); const [escalationOwner, setEscalationOwner] = useState(""); const [expiryMinutes, setExpiryMinutes] = useState("");
  const [effectivePolicy, setEffectivePolicy] = useState<EffectivePolicy | null>(null);
  const [message, setMessage] = useState("Loading approval policy…"); const [busy, setBusy] = useState(false); const [policyLoading, setPolicyLoading] = useState(true);
  const saveAttempts = useRef(new Map<string, IdempotencyAttempt>());

  useEffect(() => { fetch("/api/tasks/policy/centres", { cache: "no-store" }).then((r) => read<{ centres?: Centre[] }>(r)).then((v) => setCentres(v.centres ?? [])).catch(() => setCentres([])); }, []);
  async function refreshDirectory() {
    try {
      const response = await fetch("/api/tasks/policy?view=directory", { cache: "no-store" });
      const data = await read<{ policies?: DirectoryPolicy[] }>(response);
      if (!response.ok) throw new Error();
      setDirectory(data.policies ?? []);
      setDirectoryMessage(data.policies?.length ? "" : "No active policy scopes are available in your permissions.");
    } catch { setDirectory([]); setDirectoryMessage("Policy directory is unavailable; no changes were made."); }
  }
  useEffect(() => {
    let active = true;
    fetch("/api/tasks/policy?view=directory", { cache: "no-store" })
      .then(async (response) => ({ response, data: await read<{ policies?: DirectoryPolicy[] }>(response) }))
      .then(({ response, data }) => {
        if (!active) return;
        if (!response.ok) throw new Error();
        setDirectory(data.policies ?? []);
        setDirectoryMessage(data.policies?.length ? "" : "No active policy scopes are available in your permissions.");
      })
      .catch(() => { if (active) { setDirectory([]); setDirectoryMessage("Policy directory is unavailable; no changes were made."); } });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    fetch(`/api/tasks/policy${centreId ? `?centreId=${encodeURIComponent(centreId)}` : ""}`, { cache: "no-store" }).then(async (r) => ({ r, data: await read<{ policy?: Policy | null; effectivePolicy?: EffectivePolicy; eligibleApprovers?: Approver[] }>(r) })).then(({ r, data }) => {
      if (!active) return; if (!r.ok) throw new Error(); setPolicy(data.policy ?? null); setEffectivePolicy(data.effectivePolicy ?? null); setStaff(data.eligibleApprovers ?? []); setEnabled(data.policy?.enabled ?? false); setApproverIds(data.policy?.approverStaffIds ?? []); setEscalationMinutes(data.policy?.escalationAfterMinutes?.toString() ?? ""); setEscalationOwner(data.policy?.escalationOwnerStaffId ?? ""); setExpiryMinutes(data.policy?.expireAfterMinutes?.toString() ?? ""); setPolicyLoading(false); setMessage(data.policy ? "" : centreId && data.effectivePolicy?.source === "ORGANIZATION" ? "No centre-specific override exists." : "No policy exists for this scope. Saving creates a task-completion policy.");
    }).catch(() => { if (active) { setPolicy(null); setEffectivePolicy(null); setStaff([]); setPolicyLoading(false); setMessage("Approval policy could not be loaded. Check your owner/admin permission and retry."); } });
    return () => { active = false; };
  }, [centreId]);

  useEffect(() => {
    let active = true;
    fetch(`/api/tasks/policy?view=history${centreId ? `&centreId=${encodeURIComponent(centreId)}` : ""}${historyBefore ? `&before=${encodeURIComponent(historyBefore)}` : ""}`, { cache: "no-store" })
      .then(async (response) => ({ response, data: await read<{ history?: PolicyHistoryEntry[]; hasMore?: boolean; nextBefore?: string | null }>(response) }))
      .then(({ response, data }) => {
        if (!active) return;
        if (!response.ok) throw new Error();
        setHistory(data.history ?? []);
        setHistoryHasMore(data.hasMore ?? false);
        setHistoryNextBefore(data.nextBefore ?? null);
        setHistoryMessage(data.history?.length ? "" : "No recorded policy changes for this scope.");
      })
      .catch(() => { if (active) { setHistory([]); setHistoryHasMore(false); setHistoryNextBefore(null); setHistoryMessage("Policy history is unavailable."); } })
      .finally(() => { if (active) setHistoryBusy(false); });
    return () => { active = false; };
  }, [centreId, historyBefore, policy?.versionNumber]);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("Saving policy…");
    const minutes = escalationMinutes.trim() ? Number(escalationMinutes) : null;
    const scopeKey = `${sessionStaffId}:${centreId || "organization"}`;
    const attempt = saveAttempts.current.get(scopeKey) ?? new IdempotencyAttempt(`rudra:approval-policy:${scopeKey}`);
    saveAttempts.current.set(scopeKey, attempt);
    try {
      const expiry = expiryMinutes.trim() ? Number(expiryMinutes) : null;
      const payload = JSON.stringify({ centreId: centreId || null, actionType: "TASK_COMPLETION", enabled, approverStaffIds: approverIds, escalationAfterMinutes: minutes, escalationOwnerStaffId: minutes === null ? null : escalationOwner || null, expireAfterMinutes: expiry, expectedVersion: policy?.versionNumber ?? 0 });
      const response = await fetch("/api/tasks/policy", { method: "PUT", headers: { "content-type": "application/json", "idempotency-key": await attempt.keyFor(payload) }, body: payload });
      const data = await read<{ policy?: Policy & { replayed?: boolean }; error?: string }>(response);
      if (!response.ok) { if (response.status < 500) { attempt.clear(); saveAttempts.current.delete(scopeKey); } setMessage(data.error === "version_conflict" ? "Another administrator changed this policy. Reload before editing." : data.error === "idempotency_conflict" ? "This save key was already used for different settings. Review the policy and submit again." : data.error === "approver_not_eligible" ? "Select only active staff with task approval permission in this scope." : "Policy was not saved. Check the approver and escalation settings."); return; }
      attempt.clear(); saveAttempts.current.delete(scopeKey); setHistoryBusy(true); setPolicy(data.policy ?? null); setMessage(data.policy?.replayed ? "The prior policy save was already recorded." : "Task-completion approval policy saved."); void refreshDirectory();
    } catch { setMessage("Policy save could not be confirmed. Retry the unchanged settings to check whether they were recorded."); } finally { setBusy(false); }
  }
  function nextHistoryPage() {
    if (!historyHasMore || !historyNextBefore || historyBusy) return;
    setHistoryBusy(true);
    setHistoryCursors((cursors) => [...cursors, historyNextBefore]);
    setHistoryBefore(historyNextBefore);
  }
  function previousHistoryPage() {
    if (historyCursors.length <= 1 || historyBusy) return;
    setHistoryBusy(true);
    const cursors = historyCursors.slice(0, -1);
    setHistoryCursors(cursors);
    setHistoryBefore(cursors[cursors.length - 1] ?? null);
  }
  return <section className="admin-card"><p className="eyebrow">Restricted policy type</p><h2>Operational task completion</h2><p>This policy cannot approve refunds, financial adjustments, clinical decisions, report release, invoices, or security changes. Approvers must also hold the scoped task approval permission. An empty named-approver list means any permitted approver in scope.</p>
    <label>Policy scope<select value={centreId} onChange={(event) => selectScope(event.target.value)}><option value="">Organization default</option>{centres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name} ({centre.code})</option>)}</select></label>
    <div className="admin-card"><h3>Approval policy scopes</h3><p>Only organization and centre scopes you are authorized to manage are listed. Unconfigured scopes can be set up here. This policy applies only to operational task completion.</p>{directoryMessage && <p role="status">{directoryMessage}</p>}{directory.length > 0 && <div className="table-scroll"><table className="admin-table"><thead><tr><th>Scope</th><th>Policy</th><th>Status</th><th>Escalation</th><th>Expiry</th><th>Version</th><th>Updated</th><th>Action</th></tr></thead><tbody>{directory.map((item) => <tr key={item.centreId ?? "organization-default"}><td>{item.centreId ? `${item.centreName ?? "Centre"} (${item.centreCode ?? "active scope"})` : "Organization default"}</td><td>Operational task completion</td><td>{item.configured ? item.enabled ? "Enabled" : "Disabled" : "Not configured"}</td><td>{item.escalationAfterMinutes ? `${item.escalationAfterMinutes} minutes` : "Not configured"}</td><td>{item.expireAfterMinutes ? `${item.expireAfterMinutes} minutes` : "No expiry"}</td><td>{item.versionNumber ?? "—"}</td><td>{item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "—"}</td><td><button type="button" className="button button-secondary" onClick={() => selectScope(item.centreId ?? "")}>{item.configured ? "Review / edit" : "Configure"}</button></td></tr>)}</tbody></table></div>}</div>
    {message && <p role="status">{message}</p>}{centreId && effectivePolicy?.source === "ORGANIZATION" && <p role="status">The organization default is currently {effectivePolicy.enabled ? "enabled" : "disabled"} for this centre. Saving here creates a centre-specific override; this summary does not expose organization-level approver identities.</p>}
    <form className="admin-form task-form" onSubmit={save}>
      <label className="task-checkbox"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Allow tasks in this scope to request completion approval</label>
      <label>Named approvers (optional)<select multiple value={approverIds} onChange={(event) => setApproverIds(Array.from(event.target.selectedOptions, (option) => option.value))}>{staff.map((person) => <option key={person.id} value={person.id}>{person.displayName} ({person.staffCode})</option>)}</select></label>
      <label>Escalate after minutes (optional)<input type="number" min={15} max={10080} step={15} value={escalationMinutes} onChange={(event) => setEscalationMinutes(event.target.value)} placeholder="Leave blank to disable escalation" /></label>
      <label>Approval decision deadline after submission (minutes, optional)<input type="number" min={15} max={10080} step={15} value={expiryMinutes} onChange={(event) => setExpiryMinutes(event.target.value)} placeholder="Leave blank for no deadline" /></label>
      <p className="admin-muted">After the deadline, approve/reject actions are blocked. Until a scheduled job is configured, an authorized supervisor can run due expiry and escalation processing from the approval queue. This records configured deadline actions only; it never approves or rejects task completion.</p>
      {escalationMinutes && <label>Escalation owner<select required value={escalationOwner} onChange={(event) => setEscalationOwner(event.target.value)}><option value="">Choose an eligible approver</option>{staff.filter((person) => !approverIds.length || approverIds.includes(person.id)).map((person) => <option key={person.id} value={person.id}>{person.displayName} ({person.staffCode})</option>)}</select></label>}
      <button className="button button-primary" disabled={busy || policyLoading || (enabled && staff.length === 0)}>{busy ? "Saving…" : policyLoading ? "Loading…" : "Save approval policy"}</button>
    </form>
    <section className="admin-card"><h3>Policy change history</h3><p>Append-only audit snapshots for this authorized policy scope. Older changes may show a partial snapshot if they predate full configuration capture.</p>{historyMessage && <p role="status">{historyMessage}</p>}{history.length > 0 && <div className="table-scroll"><table className="admin-table"><thead><tr><th>Version</th><th>Enabled</th><th>Named approvers</th><th>Escalation</th><th>Expiry</th><th>Changed by</th><th>Recorded</th></tr></thead><tbody>{history.map((entry) => <tr key={entry.sequence}><td>{entry.version ?? "Legacy"}</td><td>{entry.enabled === null ? "Not captured" : entry.enabled ? "Enabled" : "Disabled"}</td><td>{entry.approverDisplayNames === null ? "Not captured" : entry.approverDisplayNames.length ? entry.approverDisplayNames.join(", ") : "Any permitted approver"}</td><td>{entry.snapshotComplete ? entry.escalationAfterMinutes === null ? "Not configured" : `${entry.escalationAfterMinutes} min · ${entry.escalationOwnerDisplayName ?? "Unavailable staff record"}` : "Partial legacy snapshot"}</td><td>{entry.snapshotComplete ? entry.expireAfterMinutes === null ? "No expiry" : `${entry.expireAfterMinutes} minutes` : "Not captured"}</td><td>{entry.actorDisplayName}</td><td>{new Date(entry.recordedAt).toLocaleString()}</td></tr>)}</tbody></table></div>}<nav aria-label="Policy history pages" className="task-pagination"><button type="button" className="button button-secondary" disabled={historyCursors.length <= 1 || historyBusy} onClick={previousHistoryPage}>Previous</button><span>Page {historyCursors.length}</span><button type="button" className="button button-secondary" disabled={!historyHasMore || historyBusy} onClick={nextHistoryPage}>Next</button></nav></section>
  </section>;
}




