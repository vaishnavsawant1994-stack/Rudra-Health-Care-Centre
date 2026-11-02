"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { getStaffTaskQueueBadges } from "@/lib/staff-task-queue-badges";
import { IdempotencyAttempt } from "@/lib/idempotency-attempt";
import { taskWorkbenchInitialTypeFilter } from "@/lib/task-workbench-filters";
import { canApproveTaskInCentre, canAssignTaskInCentre, canEscalateTaskInCentre, canUpdateTask } from "@/lib/task-permissions";
import type { TaskReferencePrefillType, TaskRelationshipReferenceType } from "@/lib/task-reference-permissions";
import type { PermissionGrant } from "@/server/permissions";

type Centre = { id: string; code: string; name: string };
type Assignee = { id: string; displayName: string; staffCode: string };
type Task = { id: string; centreId: string; taskNumber: string; title: string; description: string; reference?: { type: string; id: string; label: string } | null; taskType: string; priority: string; status: string; approvalStatus: string; approvalExpiresAt: string | null; assignedStaffId: string; assignedStaffName: string; createdByStaffId: string; dueAt: string | null; escalationOwnerStaffId: string | null; escalationDueAt: string | null; escalationProcessedAt: string | null; escalationApprovers?: Assignee[]; reassignableApprovers?: Assignee[]; versionNumber: number; requiresApproval: boolean; createdAt: string };
type TaskReferenceType = "APPOINTMENT" | "LEAD" | "LEAD_FOLLOWUP" | "PUBLIC_ENQUIRY" | "COLLECTION_JOB" | "SAMPLE_EXCEPTION" | "REPORT" | "REPORT_FOLLOWUP" | "FINANCE_PAYMENT" | "FINANCE_REFUND" | "STAFF_TASK" | "STAFF_ESCALATION" | "CORPORATE_RELATIONSHIP" | "PARTNER_RELATIONSHIP" | "DOCTOR_RELATIONSHIP";
type ReferenceOption = { id: string; label: string };
type TaskEvent = { id: string; eventType: string; actorType: "STAFF" | "SYSTEM"; actorName: string | null; approverName?: string; recordedAt: string; comment?: string | null; reason?: string | null; supportResolutionOutcome?: string };

async function responseBody<T>(response: Response) { return response.json().catch(() => ({})) as Promise<T>; }
function taskReferenceHref(type: string, id: string) {
  if (type === "APPOINTMENT") return `/appointments/${id}`;
  if (type === "LEAD") return `/leads/${id}`;
  if (type === "PUBLIC_ENQUIRY") return "/leads/public-enquiries";
  if (type === "COLLECTION_JOB") return `/collections/${id}`;
  if (type === "SAMPLE_EXCEPTION") return "/samples/exceptions";
  if (type === "REPORT") return `/reports/${id}`;
  if (type === "REPORT_FOLLOWUP") return "/reports/followups";
  if (type === "FINANCE_PAYMENT") return `/finance/payments/${id}`;
  if (type === "FINANCE_REFUND") return "/finance/refunds";
  if (type === "STAFF_TASK") return "/tasks";
  if (type === "STAFF_ESCALATION") return `/escalations?escalationId=${encodeURIComponent(id)}`;
  if (type === "CORPORATE_RELATIONSHIP") return "/relationships/corporate";
  if (type === "PARTNER_RELATIONSHIP") return "/relationships/partners";
  if (type === "DOCTOR_RELATIONSHIP") return "/relationships/doctors";
  return null;
}

export function TaskWorkbench({ staffId, permissionGrants = [], canCreate, canRead = true, canUpdate, canApprove, canFilterCentre = false, relationshipReferenceTypes = [], initialFilter = "", initialTaskType = "", initialTaskId, initialCentreId, initialReferenceType, initialReferenceId, fixedTaskType }: { staffId: string; permissionGrants?: PermissionGrant[]; canCreate: boolean; canRead?: boolean; canUpdate: boolean; canApprove: boolean; canAssign: boolean; canEscalate?: boolean; canFilterCentre?: boolean; relationshipReferenceTypes?: TaskRelationshipReferenceType[]; initialFilter?: string; initialTaskType?: string; initialTaskId?: string; initialCentreId?: string; initialReferenceType?: TaskReferencePrefillType; initialReferenceId?: string; fixedTaskType?: string }) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [centres, setCentres] = useState<Centre[]>([]);
  const [readCentres, setReadCentres] = useState<Centre[]>([]);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [approvers, setApprovers] = useState<Assignee[]>([]);
  const [reassignableApprovers, setReassignableApprovers] = useState<Assignee[]>([]);
  const [approvalApproverStaffId, setApprovalApproverStaffId] = useState("");
  const [filter, setFilter] = useState(initialFilter);
  const [typeFilter, setTypeFilter] = useState(() => taskWorkbenchInitialTypeFilter(initialTaskType, fixedTaskType));
  const [message, setMessage] = useState(canRead ? "Loading tasks…" : "You can submit requests, but task history access is not assigned to your role.");
  const [deadlineMessage, setDeadlineMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const taskCreateAttempt = useMemo(() => new IdempotencyAttempt(`rudra:staff-task:create:${staffId}`), [staffId]);
  const taskActionAttempts = useRef(new Map<string, IdempotencyAttempt>());
  const taskEscalationAttempts = useRef(new Map<string, IdempotencyAttempt>());
  const [centreId, setCentreId] = useState(initialCentreId ?? "");
  const [centreFilter, setCentreFilter] = useState("");
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("NORMAL");
  const [taskType, setTaskType] = useState(initialTaskType || fixedTaskType || "GENERAL");
  const mayAssign = useCallback((centreId: string, type = fixedTaskType || taskType) => canAssignTaskInCentre(permissionGrants, centreId, type), [fixedTaskType, permissionGrants, taskType]);
  const mayApprove = useCallback((centreId: string) => canApproveTaskInCentre(permissionGrants, centreId), [permissionGrants]);
  const [referenceType, setReferenceType] = useState<TaskReferenceType | "">(initialReferenceType && (initialReferenceType === "STAFF_ESCALATION" || relationshipReferenceTypes.includes(initialReferenceType)) ? initialReferenceType : "");
  const [referenceId, setReferenceId] = useState(initialReferenceId ?? "");
  const [references, setReferences] = useState<ReferenceOption[]>([]);
  const [referencePage, setReferencePage] = useState(1);
  const [referencesHaveMore, setReferencesHaveMore] = useState(false);
  const [dueAt, setDueAt] = useState("");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [history, setHistory] = useState<TaskEvent[]>([]);
  const [comment, setComment] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [supportResolutionOutcome, setSupportResolutionOutcome] = useState("");
  const [assigneeId, setAssigneeId] = useState(staffId);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editPriority, setEditPriority] = useState("NORMAL"); const [editDueAt, setEditDueAt] = useState("");
  const [escalationOwner, setEscalationOwner] = useState(""); const [escalationDueAt, setEscalationDueAt] = useState("");
  const [showTaskEscalation, setShowTaskEscalation] = useState(false);
  const [taskEscalationTitle, setTaskEscalationTitle] = useState("");
  const [taskEscalationDescription, setTaskEscalationDescription] = useState("");
  const [taskEscalationDueAt, setTaskEscalationDueAt] = useState("");
  const [taskEscalationSeverity, setTaskEscalationSeverity] = useState("MODERATE");
  const [taskEscalationPriority, setTaskEscalationPriority] = useState("NORMAL");

  const load = useCallback(async () => {
    if (!canRead) return;
    setMessage("Loading tasks…");
    try {
      const params = new URLSearchParams(); if (filter) params.set("status", filter); if (typeFilter) params.set("type", typeFilter); if (centreFilter) params.set("centreId", centreFilter); params.set("page", String(page));
      const response = await fetch(`/api/tasks${params.size ? `?${params}` : ""}`, { cache: "no-store" });
      const body = await responseBody<{ tasks?: Task[]; error?: string; hasMore?: boolean }>(response);
      if (!response.ok) throw new Error(body.error ?? "task_service_unavailable");
      setTasks(body.tasks ?? []);
      setHasMore(body.hasMore ?? false);
      setMessage(body.tasks?.length ? "" : "No tasks in this view.");
    } catch { setTasks([]); setMessage("Task service is unavailable. Retry when connected."); }
  }, [canRead, filter, typeFilter, centreFilter, page]);

  useEffect(() => {
    if (!canRead) return;
    let active = true;
    const params = new URLSearchParams(); if (filter) params.set("status", filter); if (typeFilter) params.set("type", typeFilter); if (centreFilter) params.set("centreId", centreFilter); params.set("page", String(page));
    fetch(`/api/tasks${params.size ? `?${params}` : ""}`, { cache: "no-store" })
      .then(async (response) => ({ response, body: await responseBody<{ tasks?: Task[]; error?: string; hasMore?: boolean }>(response) }))
      .then(({ response, body }) => {
        if (!active) return;
        if (!response.ok) throw new Error(body.error ?? "task_service_unavailable");
        setTasks(body.tasks ?? []);
        setHasMore(body.hasMore ?? false);
        setMessage(body.tasks?.length ? "" : "No tasks in this view.");
      })
      .catch(() => { if (active) { setTasks([]); setMessage("Task service is unavailable. Retry when connected."); } });
    return () => { active = false; };
  }, [canRead, filter, typeFilter, centreFilter, page]);
  useEffect(() => {
    if (!canCreate) return;
    void fetch("/api/tasks/centres", { cache: "no-store" }).then((response) => responseBody<{ centres?: Centre[] }>(response)).then((body) => {
      const items = body.centres ?? [];
      setCentres(items);
      if (initialCentreId && items.some((item) => item.id === initialCentreId)) setCentreId(initialCentreId);
      else if (items.length === 1) setCentreId(items[0].id);
    }).catch(() => setCentres([]));
  }, [canCreate, initialCentreId]);
  useEffect(() => {
    if (!canFilterCentre) return;
    let active = true;
    fetch("/api/tasks/centres?view=read", { cache: "no-store" }).then((response) => responseBody<{ centres?: Centre[] }>(response)).then((body) => { if (active) setReadCentres(body.centres ?? []); }).catch(() => { if (active) setReadCentres([]); });
    return () => { active = false; };
  }, [canFilterCentre]);
  useEffect(() => {
    if (!centreId || !mayAssign(centreId)) return;
    let active = true;
    fetch(`/api/tasks/assignees?centreId=${encodeURIComponent(centreId)}`, { cache: "no-store" }).then((response) => responseBody<{ staff?: Assignee[] }>(response)).then((data) => { if (active) setAssignees(data.staff ?? []); }).catch(() => { if (active) setAssignees([]); });
    return () => { active = false; };
  }, [mayAssign, centreId, staffId]);
  useEffect(() => {
    if (!centreId || !mayApprove(centreId) || selected) return;
    let active = true;
    fetch(`/api/tasks/approvers?centreId=${encodeURIComponent(centreId)}`, { cache: "no-store" }).then((response) => responseBody<{ approvers?: Assignee[] }>(response)).then((data) => { if (active) setApprovers(data.approvers ?? []); }).catch(() => { if (active) setApprovers([]); });
    return () => { active = false; };
  }, [mayApprove, centreId, selected]);
  useEffect(() => {
    if (!centreId || !referenceType) return;
    let active = true;
    fetch(`/api/tasks/references?centreId=${encodeURIComponent(centreId)}&type=${referenceType}&page=${referencePage}`, { cache: "no-store" })
      .then((response) => responseBody<{ references?: ReferenceOption[]; hasMore?: boolean }>(response))
      .then((body) => { if (!active) return; const next = body.references ?? []; setReferences(current => referencePage === 1 ? next : [...current, ...next.filter(item => !current.some(existing => existing.id === item.id))]); setReferencesHaveMore(Boolean(body.hasMore)); const keepDeepLink = Boolean(initialReferenceId && centreId === initialCentreId && referenceType === initialReferenceType); if (referencePage === 1 && !keepDeepLink) setReferenceId(next[0]?.id ?? ""); })
      .catch(() => { if (active) { setReferences([]); setReferencesHaveMore(false); } });
    return () => { active = false; };
  }, [centreId, referenceType, referencePage, initialReferenceId, initialCentreId, initialReferenceType]);

  async function createTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!centreId) { setMessage("Choose a centre with task creation access."); return; }
    const attempt = taskCreateAttempt;
    setBusy(true); setMessage("Saving task…");
    try {
      const bodyJson = JSON.stringify({ centreId, assignedStaffId: mayAssign(centreId, taskType) ? assigneeId : staffId, title, description, priority, taskType, dueAt: dueAt ? new Date(dueAt).toISOString() : null, requiresApproval, reference: referenceType && referenceId ? { type: referenceType, id: referenceId } : null });
      const idempotencyKey = await attempt.keyFor(bodyJson);
      const response = await fetch("/api/tasks", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: bodyJson });
      const body = await responseBody<{ error?: string; task?: { taskNumber: string } }>(response);
      if (!response.ok) { if (response.status < 500) attempt.clear(); setMessage(body.error === "assignee_not_found" ? "Your account is not active in the selected centre." : response.status >= 500 ? "Task save could not be confirmed. Retry the unchanged form to safely check whether it saved." : "Task could not be created. Check your centre access and try again."); return; }
      attempt.clear();
      setTitle(""); setDescription(""); setDueAt(""); setRequiresApproval(false); setReferenceType(""); setReferenceId(""); setMessage(`Created ${body.task?.taskNumber ?? "task"}.`); if (canRead) await load();
    } catch { setMessage("Task save could not be confirmed. Retry the unchanged form to safely check whether it saved."); }
    finally { setBusy(false); }
  }

  const openTask = useCallback(async (id: string) => {
    setSelected(id); setHistory([]);
    try {
      const response = await fetch(`/api/tasks/${id}`, { cache: "no-store" });
      const body = await responseBody<{ task?: Task; history?: TaskEvent[] }>(response);
      if (!response.ok) { setSelectedTask(null); setMessage("Task details are unavailable in your current scope."); return; }
      setHistory(body.history ?? []);
      if (body.task) { setSelectedTask(body.task); setCentreId(body.task.centreId); if (body.task.escalationApprovers) setApprovers(body.task.escalationApprovers); setReassignableApprovers(body.task.reassignableApprovers ?? []); setApprovalApproverStaffId(body.task.reassignableApprovers?.[0]?.id ?? ""); setEditTitle(body.task.title); setEditDescription(body.task.description); setAssigneeId(body.task.assignedStaffId); setEditPriority(body.task.priority); setEditDueAt(body.task.dueAt ? new Date(new Date(body.task.dueAt).getTime() - new Date(body.task.dueAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : ""); setEscalationOwner(body.task.escalationOwnerStaffId ?? ""); setEscalationDueAt(body.task.escalationDueAt ? new Date(new Date(body.task.escalationDueAt).getTime() - new Date(body.task.escalationDueAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 16) : ""); }
    } catch { setSelectedTask(null); setMessage("Task history is unavailable. Retry when connected."); }
  }, []);

  const initialTaskOpened = useRef<string | null>(null);
  useEffect(() => {
    if (!initialTaskId || !canRead || selected || initialTaskOpened.current === initialTaskId) return;
    initialTaskOpened.current = initialTaskId;
    void openTask(initialTaskId);
  }, [canRead, initialTaskId, openTask, selected]);

  async function action(task: Task, actionName: string, extra: Record<string, unknown> = {}) {
    setBusy(true); setMessage("Saving task update…");
    const attemptScope = `${task.id}:${actionName}`;
    const attempt = taskActionAttempts.current.get(attemptScope) ?? new IdempotencyAttempt(`rudra:staff-task:action:${staffId}:${attemptScope}`);
    taskActionAttempts.current.set(attemptScope, attempt);
    try {
      const requestKeyPayload = JSON.stringify({ taskId: task.id, action: actionName, ...extra });
      const idempotencyKey = await attempt.keyFor(requestKeyPayload);
      const response = await fetch(`/api/tasks/${task.id}`, { method: "PATCH", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify({ expectedVersion: task.versionNumber, action: actionName, ...extra }) });
      const body = await responseBody<{ error?: string; replayed?: boolean }>(response);
      if (!response.ok) { if (response.status < 500) { attempt.clear(); taskActionAttempts.current.delete(attemptScope); } setMessage(body.error === "version_conflict" ? "This task changed elsewhere. Refresh the list before editing again." : body.error === "idempotency_conflict" ? "This request key was used for a different task action. Refresh the task before retrying." : body.error === "approval_expiry_due" ? "The approval window expired. A permitted approver must record the expiry before another request can be submitted." : body.error === "approval_expiry_not_due" ? "This approval has not reached its configured expiry time." : body.error === "approval_policy_approver_unavailable" ? "Approval was not submitted: the policy has no currently eligible centre approver or escalation owner. Ask an authorized policy manager to update the policy." : body.error === "approval_policy_unavailable" ? "Approval was not submitted because no enabled task-completion policy applies to this centre." : body.error === "escalation_owner_conflict" ? actionName === "REASSIGN_ESCALATION" ? "Escalation was not reassigned: choose an approver other than this task's creator and assignee." : "Approval was not submitted: the configured escalation owner must differ from this task's creator and assignee. Ask an authorized policy manager to correct the escalation owner, then retry." : "Task update was not accepted. Check your permissions and task state."); return false; }
      attempt.clear(); taskActionAttempts.current.delete(attemptScope);
      setMessage(body.replayed ? "The prior task action was already saved." : "Task updated."); await load(); await openTask(task.id); return true;
    } catch { setMessage("Task action could not be confirmed. Retry the unchanged action to safely check whether it saved."); return false; }
    finally { setBusy(false); }
  }

  async function processDueDeadlines() {
    if (!canApprove || busy) return;
    setBusy(true); setDeadlineMessage("Processing due approval deadlines in your authorized centres…");
    try {
      const response = await fetch("/api/tasks/approvals/process-due", { method: "POST", cache: "no-store" });
      const body = await responseBody<{ processed?: number; expired?: number; escalated?: number; skippedInvalidOwner?: number; error?: string }>(response);
      if (!response.ok) { setDeadlineMessage(response.status === 401 || response.status === 403 || response.status === 428 ? "You are not authorized to process due approvals in this session." : "Due approvals could not be processed. No task details were returned."); return; }
      setDeadlineMessage(`${body.processed ?? 0} due item(s) processed: ${body.expired ?? 0} expired, ${body.escalated ?? 0} escalated${body.skippedInvalidOwner ? `, ${body.skippedInvalidOwner} skipped for owner conflict` : ""}.`);
      await load();
    } catch { setDeadlineMessage("Processing could not be confirmed. Refresh the queue before retrying."); }
    finally { setBusy(false); }
  }

  async function raiseTaskEscalation(event: React.FormEvent<HTMLFormElement>, task: Task) {
    event.preventDefault();
    if (!taskEscalationTitle.trim() || !taskEscalationDueAt) { setMessage("Add an escalation title and due time."); return; }
    setBusy(true); setMessage("Creating linked escalation…");
    const attempt = taskEscalationAttempts.current.get(task.id) ?? new IdempotencyAttempt(`rudra:staff-task:escalation:${staffId}:${task.id}`);
    taskEscalationAttempts.current.set(task.id, attempt);
    try {
      const bodyJson = JSON.stringify({ centreId: task.centreId, source: { type: "STAFF_TASK", id: task.id }, title: taskEscalationTitle.trim(), description: taskEscalationDescription.trim(), severity: taskEscalationSeverity, priority: taskEscalationPriority, assignedOwnerStaffId: staffId, dueAt: new Date(taskEscalationDueAt).toISOString(), deduplicateOpenSource: true });
      const idempotencyKey = await attempt.keyFor(bodyJson);
      const response = await fetch("/api/escalations", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": idempotencyKey }, body: bodyJson });
      const body = await responseBody<{ error?: string; escalation?: { escalationNumber: string }; alreadyOpen?: boolean }>(response);
      if (!response.ok) { if (response.status < 500) { attempt.clear(); taskEscalationAttempts.current.delete(task.id); } setMessage(body.error === "source_not_found_or_forbidden" ? "You cannot raise an escalation for this task in your current scope." : response.status >= 500 ? "Escalation creation could not be confirmed. Retry unchanged or check the escalation queue." : "Escalation could not be created. Check your access and due time."); return; }
      attempt.clear(); taskEscalationAttempts.current.delete(task.id);
      setShowTaskEscalation(false); setTaskEscalationTitle(""); setTaskEscalationDescription(""); setMessage(body.escalation?.escalationNumber ? `Created ${body.escalation.escalationNumber}.` : "An open escalation already exists for this task.");
    } catch { setMessage("Escalation creation could not be confirmed. Retry unchanged or check the escalation queue."); }
    finally { setBusy(false); }
  }

  const current = selectedTask?.id === selected ? selectedTask : tasks.find((task) => task.id === selected);
  const currentCanUpdate = current ? canUpdateTask(permissionGrants, current.centreId, current.assignedStaffId, staffId, current.taskType) : false;
  const currentCanAssign = current ? canAssignTaskInCentre(permissionGrants, current.centreId, current.taskType) : false;
  const currentCanApprove = current ? canApproveTaskInCentre(permissionGrants, current.centreId) : false;
  const currentCanEscalate = current ? canEscalateTaskInCentre(permissionGrants, current.centreId) : false;
  return <>
    {canCreate && <section className="admin-card"><h2>Create task</h2><p>Task descriptions are private encrypted data. Avoid including unnecessary patient or clinical details.</p><form className="admin-form task-form" onSubmit={createTask}>
      <label>Centre<select required value={centreId} onChange={(event) => { setAssignees([]); setAssigneeId(staffId); setCentreId(event.target.value); setReferenceId(""); setReferences([]); setReferencePage(1); setReferencesHaveMore(false); }}><option value="">Choose a centre</option>{centres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name} ({centre.code})</option>)}</select></label>
      {centreId && mayAssign(centreId, taskType) && <label>Assign to<select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}><option value={staffId}>Myself</option>{assignees.filter((item) => item.id !== staffId).map((item) => <option key={item.id} value={item.id}>{item.displayName} ({item.staffCode})</option>)}</select></label>}
      <label>Title<input required minLength={3} maxLength={120} value={title} onChange={(event) => setTitle(event.target.value)} /></label>
      <label>Description<textarea maxLength={1000} value={description} onChange={(event) => setDescription(event.target.value)} /></label>
      {fixedTaskType ? <p>New items created here are classified as {fixedTaskType.replaceAll("_", " ")} and stored as encrypted operational tasks.</p> : <label>Type<select value={taskType} onChange={(event) => setTaskType(event.target.value)}>{["GENERAL", "OPERATIONS", "FOLLOW_UP", "EXCEPTION_REVIEW", "SUPPORT_REQUEST"].map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>}
      <label>Link to operational record<select value={referenceType} onChange={(event) => { setReferenceType(event.target.value as TaskReferenceType | ""); setReferenceId(""); setReferences([]); setReferencePage(1); setReferencesHaveMore(false); }}><option value="">No linked record</option><option value="APPOINTMENT">Appointment</option><option value="LEAD">CRM lead</option><option value="LEAD_FOLLOWUP">CRM follow-up</option><option value="PUBLIC_ENQUIRY">Website enquiry</option><option value="COLLECTION_JOB">Collection job</option><option value="SAMPLE_EXCEPTION">Sample exception</option><option value="REPORT">Diagnostic report</option><option value="REPORT_FOLLOWUP">Report follow-up</option><option value="FINANCE_PAYMENT">Disputed payment</option><option value="FINANCE_REFUND">Requested refund</option>{permissionGrants.some((grant) => (grant.key === "escalations.read" || grant.key === "escalations.assigned.read") && (grant.centreId === null || grant.centreId === centreId)) && <option value="STAFF_ESCALATION">Operational escalation</option>}{relationshipReferenceTypes.includes("CORPORATE_RELATIONSHIP") && <option value="CORPORATE_RELATIONSHIP">Corporate relationship</option>}{relationshipReferenceTypes.includes("PARTNER_RELATIONSHIP") && <option value="PARTNER_RELATIONSHIP">Partner relationship</option>}{relationshipReferenceTypes.includes("DOCTOR_RELATIONSHIP") && <option value="DOCTOR_RELATIONSHIP">Doctor relationship</option>}</select></label>
      {referenceType && <label>Record<select value={referenceId} onChange={(event) => setReferenceId(event.target.value)}><option value="">Choose a permitted record</option>{initialReferenceId && referenceId === initialReferenceId && !references.some((item) => item.id === initialReferenceId) && <option value={initialReferenceId}>Selected relationship (server verifies access on save)</option>}{references.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>{referencesHaveMore && <button type="button" className="text-button" onClick={() => setReferencePage(value => value + 1)}>Load more related records</button>}</label>}
      <label>Priority<select value={priority} onChange={(event) => setPriority(event.target.value)}>{["LOW", "NORMAL", "HIGH", "URGENT"].map((item) => <option key={item}>{item}</option>)}</select></label>
      <label>Due date<input type="datetime-local" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
      <label className="task-checkbox"><input type="checkbox" checked={requiresApproval} onChange={(event) => setRequiresApproval(event.target.checked)} /> Require a separate supervisor approval to complete</label>
      <button className="button button-primary" disabled={busy || !centreId}>{busy ? "Saving…" : "Create task"}</button>
    </form></section>}
    {!canRead && message && <p role="status">{message}</p>}
    {canRead ? <section className="admin-card"><div className="task-toolbar"><div><h2>{fixedTaskType === "SUPPORT_REQUEST" || initialTaskType === "SUPPORT_REQUEST" ? "Support requests and service issues" : initialFilter === "ESCALATED" ? "Exception and escalation queue" : initialFilter === "APPROVAL_ESCALATION_DUE" ? "Task approval escalations due" : canUpdate ? "Task queue" : "My tasks"}</h2><p>Approval decisions are restricted to separate supervisors with the task approval permission. Exception-review entries link back to their authorized operational record.</p></div>{canApprove && <button type="button" className="button button-secondary" disabled={busy} onClick={() => void processDueDeadlines()}>Process due approval deadlines</button>}{canFilterCentre && readCentres.length > 1 && <label>Centre<select value={centreFilter} onChange={(event) => { setCentreFilter(event.target.value); setPage(1); }}><option value="">All authorized centres</option>{readCentres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name} ({centre.code})</option>)}</select></label>}<label>Status<select value={filter} onChange={(event) => { setFilter(event.target.value); setPage(1); }}><option value="">All visible</option>{["OVERDUE", "ESCALATED", "APPROVAL_EXPIRY_DUE", "APPROVAL_ESCALATION_DUE", "OPEN", "IN_PROGRESS", "AWAITING_APPROVAL", "COMPLETED", "CANCELLED"].map((status) => <option key={status}>{status.replaceAll("_", " ")}</option>)}</select></label>{!fixedTaskType && <label>Type<select value={typeFilter} onChange={(event) => { setTypeFilter(event.target.value); setPage(1); }}><option value="">All task types</option>{["GENERAL", "OPERATIONS", "FOLLOW_UP", "EXCEPTION_REVIEW", "SUPPORT_REQUEST"].map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select></label>}</div>
      {deadlineMessage && <p role="status" aria-live="polite">{deadlineMessage}</p>}
      {message && <p role="status">{message}</p>}
      {tasks.length > 0 && <div className="table-scroll"><table className="admin-table"><thead><tr><th>Task</th><th>Type</th><th>Priority</th><th>Assigned to</th><th>Due</th><th>Status</th><th>Action</th></tr></thead><tbody>{tasks.map((task) => { const badges = getStaffTaskQueueBadges(task); return <tr key={task.id}><td><strong>{task.title}</strong><small className="appointment-sub">{task.taskNumber}{task.description ? ` · ${task.description}` : ""}</small></td><td>{task.taskType}</td><td>{task.priority}</td><td>{task.assignedStaffName}</td><td>{task.dueAt ? new Date(task.dueAt).toLocaleString() : "No due date"}</td><td>{task.status}{task.approvalStatus === "PENDING" ? " · approval pending" : ""}{badges.map((badge) => ` · ${badge}`).join("")}</td><td><button type="button" className="text-button" onClick={() => void openTask(task.id)}>Details</button></td></tr>; })}</tbody></table></div>}
      <nav aria-label="Task queue pages" className="task-pagination"><button type="button" className="button button-secondary" disabled={page <= 1} onClick={() => setPage((currentPage) => Math.max(1, currentPage - 1))}>Previous</button><span>Page {page}</span><button type="button" className="button button-secondary" disabled={!hasMore} onClick={() => setPage((currentPage) => currentPage + 1)}>Next</button></nav>
    </section> : null}
    {current && <section className="admin-card task-detail"><div className="task-toolbar"><div><p className="eyebrow">{current.taskNumber}</p><h2>{current.title}</h2><p>{current.description || "No description provided."}</p>{current.reference && <p>Linked: {taskReferenceHref(current.reference.type, current.reference.id) ? <Link href={taskReferenceHref(current.reference.type, current.reference.id)!}>{current.reference.label}</Link> : current.reference.label}</p>}</div><button type="button" className="button button-secondary" onClick={() => setSelected(null)}>Close</button></div>
      {currentCanUpdate && !["COMPLETED", "CANCELLED"].includes(current.status) && <form className="admin-form task-form" onSubmit={(event) => { event.preventDefault(); void action(current, "UPDATE", { title: editTitle, description: editDescription, priority: editPriority, dueAt: editDueAt ? new Date(editDueAt).toISOString() : null, ...(currentCanAssign ? { assignedStaffId: assigneeId } : {}) }); }}><h3>Edit task</h3><label>Title<input required minLength={3} maxLength={120} value={editTitle} onChange={(event) => setEditTitle(event.target.value)} /></label><label>Description<textarea maxLength={1000} value={editDescription} onChange={(event) => setEditDescription(event.target.value)} /></label><label>Priority<select value={editPriority} onChange={(event) => setEditPriority(event.target.value)}>{["LOW", "NORMAL", "HIGH", "URGENT"].map((item) => <option key={item}>{item}</option>)}</select></label><label>Due date<input type="datetime-local" value={editDueAt} onChange={(event) => setEditDueAt(event.target.value)} /></label>{currentCanAssign && <label>Assignee<select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)}>{assignees.map((item) => <option key={item.id} value={item.id}>{item.displayName} ({item.staffCode})</option>)}</select></label>}<button className="button button-secondary" disabled={busy}>Save task changes</button></form>}
      <div className="task-actions">
        {currentCanEscalate && current.status !== "CANCELLED" && <section className="admin-card"><h3>Operational escalation</h3>{!showTaskEscalation ? <button className="button button-secondary" type="button" onClick={() => { setTaskEscalationTitle(`Review ${current.taskNumber}`); setTaskEscalationDueAt(new Date(Date.now() + 24 * 60 * 60_000 - new Date().getTimezoneOffset() * 60_000).toISOString().slice(0, 16)); setShowTaskEscalation(true); }}>Raise escalation for this task</button> : <form className="admin-form task-form" onSubmit={(event) => void raiseTaskEscalation(event, current)}><label>Title<input required minLength={3} maxLength={120} value={taskEscalationTitle} onChange={(event) => setTaskEscalationTitle(event.target.value)} /></label><label>Description<textarea maxLength={2000} value={taskEscalationDescription} onChange={(event) => setTaskEscalationDescription(event.target.value)} /></label><label>Severity<select value={taskEscalationSeverity} onChange={(event) => setTaskEscalationSeverity(event.target.value)}>{["LOW", "MODERATE", "HIGH", "URGENT"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Priority<select value={taskEscalationPriority} onChange={(event) => setTaskEscalationPriority(event.target.value)}>{["LOW", "NORMAL", "HIGH", "URGENT"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Due at<input type="datetime-local" required value={taskEscalationDueAt} onChange={(event) => setTaskEscalationDueAt(event.target.value)} /></label><button className="button button-primary" disabled={busy}>Create escalation</button><button className="button button-secondary" type="button" disabled={busy} onClick={() => setShowTaskEscalation(false)}>Cancel</button></form>}</section>}
        {currentCanUpdate && current.status === "OPEN" && <button className="button button-secondary" disabled={busy} onClick={() => void action(current, "START")}>Start</button>}
        {currentCanUpdate && current.taskType === "SUPPORT_REQUEST" && !["COMPLETED", "CANCELLED", "AWAITING_APPROVAL"].includes(current.status) && <label>Recorded service outcome<select required value={supportResolutionOutcome} onChange={(event) => setSupportResolutionOutcome(event.target.value)}><option value="">Choose an outcome before completion</option><option value="CUSTOMER_CONFIRMED_RESOLVED">Customer confirmed resolved</option><option value="INTERNAL_OPERATIONAL_RESOLVED">Resolved internally</option><option value="REFERRED_TO_EXISTING_WORKFLOW">Referred to an existing workflow</option><option value="UNABLE_TO_CONTACT">Unable to contact</option><option value="OTHER">Other documented outcome</option></select><small>Select only an outcome actually established. This does not record clinical assessment or patient satisfaction.</small></label>}
        {currentCanUpdate && !current.requiresApproval && ["OPEN", "IN_PROGRESS"].includes(current.status) && <>
          <button className="button button-secondary" disabled={busy || (current.taskType === "SUPPORT_REQUEST" && !supportResolutionOutcome)} onClick={() => void action(current, "COMPLETE", current.taskType === "SUPPORT_REQUEST" ? { supportResolutionOutcome } : {})}>Complete</button>
        </>}
        {currentCanUpdate && current.requiresApproval && ["OPEN", "IN_PROGRESS"].includes(current.status) && <button className="button button-secondary" disabled={busy || (current.taskType === "SUPPORT_REQUEST" && !supportResolutionOutcome)} onClick={() => void action(current, "SUBMIT_APPROVAL", current.taskType === "SUPPORT_REQUEST" ? { supportResolutionOutcome } : {})}>Submit for approval</button>}
        {currentCanApprove && current.status === "AWAITING_APPROVAL" && <>
          {current.approvalExpiresAt && <p role="status">{new Date(current.approvalExpiresAt) <= new Date() ? "Approval expiry is due" : "Approval expires"} · {new Date(current.approvalExpiresAt).toLocaleString()}</p>}
          {current.approvalExpiresAt && new Date(current.approvalExpiresAt) <= new Date() && <button className="button button-secondary" disabled={busy || current.assignedStaffId === staffId || current.createdByStaffId === staffId || !decisionReason.trim()} onClick={() => void action(current, "EXPIRE_APPROVAL", { reason: decisionReason.trim() })}>Record approval expiry</button>}
        {current.escalationDueAt && <p role="status">{current.escalationProcessedAt ? "Escalated" : new Date(current.escalationDueAt) <= new Date() ? "Escalation overdue" : "Escalation due"} · {new Date(current.escalationDueAt).toLocaleString()}{current.escalationOwnerStaffId ? ` · owner ${approvers.find((person) => person.id === current.escalationOwnerStaffId)?.displayName ?? "configured approver"}` : ""}</p>}
          {current.escalationDueAt && new Date(current.escalationDueAt) <= new Date() && !current.escalationProcessedAt && current.escalationOwnerStaffId && <><button className="button button-secondary" disabled={busy || current.assignedStaffId === current.escalationOwnerStaffId || current.createdByStaffId === current.escalationOwnerStaffId} onClick={() => void action(current, "TRIGGER_ESCALATION")}>Escalate to configured owner</button>{(current.assignedStaffId === current.escalationOwnerStaffId || current.createdByStaffId === current.escalationOwnerStaffId) && <p role="status">Escalation is blocked because the configured owner created or is assigned this task. Update the policy owner for future submissions.</p>}</>}
          {current.escalationProcessedAt && <p>The configured approver can now review this item. Task completion remains pending separate approval.</p>}
          <label>Decision reason<input minLength={3} maxLength={240} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} /></label>
          <button className="button button-primary" disabled={busy || current.assignedStaffId === staffId || new Date(current.approvalExpiresAt ?? "9999-01-01") <= new Date() || !decisionReason.trim()} onClick={() => void action(current, "APPROVE", { reason: decisionReason.trim() })}>Approve completion</button>
          <button className="button button-secondary" disabled={busy || current.assignedStaffId === staffId || new Date(current.approvalExpiresAt ?? "9999-01-01") <= new Date() || !decisionReason.trim()} onClick={() => void action(current, "REJECT", { reason: decisionReason.trim() })}>Reject completion</button>
          <button className="button button-secondary" disabled={busy || current.assignedStaffId === staffId || new Date(current.approvalExpiresAt ?? "9999-01-01") <= new Date() || !decisionReason.trim()} onClick={() => void action(current, "REQUEST_CHANGES", { reason: decisionReason.trim() })}>Request changes</button>
        </>}
        {currentCanAssign && currentCanApprove && current.status === "AWAITING_APPROVAL" && current.approvalStatus === "PENDING" && <form className="admin-form task-form" onSubmit={(event) => { event.preventDefault(); if (!approvalApproverStaffId || !decisionReason.trim()) return; void action(current, "REASSIGN_APPROVER", { approverStaffId: approvalApproverStaffId, reason: decisionReason.trim() }); }}><h3>Reassign approval reviewer</h3><p>Use this when the submitted reviewer is no longer available. The original submission snapshot stays in history; this records a new reviewer for this pending request. The task creator and assignee cannot review it.</p><label>Eligible reviewer<select required value={approvalApproverStaffId} onChange={(event) => setApprovalApproverStaffId(event.target.value)}><option value="">Choose a reviewer</option>{reassignableApprovers.map((person) => <option key={person.id} value={person.id}>{person.displayName} ({person.staffCode})</option>)}</select></label><label>Reason<input required minLength={3} maxLength={240} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} /></label><button className="button button-secondary" disabled={busy || !approvalApproverStaffId || !decisionReason.trim()}>Reassign reviewer</button></form>}
        {currentCanAssign && currentCanApprove && current.status === "AWAITING_APPROVAL" && current.approvalStatus === "PENDING" && current.escalationDueAt && <form className="admin-form task-form" onSubmit={(event) => { event.preventDefault(); if (!decisionReason.trim()) return; void action(current, "REASSIGN_ESCALATION", { escalationOwnerStaffId: escalationOwner, escalationDueAt: escalationDueAt ? new Date(escalationDueAt).toISOString() : "", reason: decisionReason.trim() }); }}><h3>Reassign approval escalation</h3><p>Change the pending escalation owner or deadline. Choose an independent approver who did not create or receive this task. This does not approve the task.</p><label>Eligible approver<select required value={escalationOwner} onChange={(event) => setEscalationOwner(event.target.value)}><option value="">Choose an approver</option>{approvers.filter((person) => person.id !== current.assignedStaffId && person.id !== current.createdByStaffId).map((person) => <option key={person.id} value={person.id}>{person.displayName} ({person.staffCode})</option>)}</select></label><label>New due date and time<input required type="datetime-local" value={escalationDueAt} onChange={(event) => setEscalationDueAt(event.target.value)} /></label><label>Reason<input required minLength={3} maxLength={240} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} /></label><button className="button button-secondary" disabled={busy || !escalationOwner || !escalationDueAt || !decisionReason.trim()}>Reassign escalation</button></form>}
        {currentCanUpdate && !["COMPLETED", "CANCELLED"].includes(current.status) && <><label>Cancellation reason<input minLength={3} maxLength={240} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} /></label><button className="button button-secondary" disabled={busy || !decisionReason.trim()} onClick={() => void action(current, "CANCEL", { reason: decisionReason.trim() })}>Cancel task</button></>}
        {["COMPLETED", "CANCELLED"].includes(current.status) && currentCanUpdate && <><label>Reason for reopening<input required minLength={3} maxLength={240} value={decisionReason} onChange={(event) => setDecisionReason(event.target.value)} /></label><button className="button button-secondary" disabled={busy || !decisionReason.trim()} onClick={() => void action(current, "REOPEN", { reason: decisionReason.trim() })}>Reopen task</button></>}
        <Link className="button-link" href="/staff/workspace">Back to workspace</Link>
      </div>
      {currentCanUpdate && <form className="task-comment" onSubmit={(event) => { event.preventDefault(); if (comment.trim()) void action(current, "COMMENT", { comment: comment.trim() }).then((saved) => { if (saved) setComment(""); }); }}><label>Comment<input maxLength={1000} value={comment} onChange={(event) => setComment(event.target.value)} /></label><button className="button button-secondary" disabled={busy || !comment.trim()}>Add comment</button></form>}
      <h3>History</h3><ol className="sample-timeline">{history.map((event) => <li key={event.id}><strong>{event.eventType.replaceAll("_", " ")}</strong><span>{event.actorName ?? (event.actorType === "SYSTEM" ? "System process" : "Staff account unavailable")} · {new Date(event.recordedAt).toLocaleString()}</span>{event.supportResolutionOutcome && <span>Recorded service outcome: {event.supportResolutionOutcome.replaceAll("_", " ").toLowerCase()}</span>}{event.approverName && <span>Assigned reviewer: {event.approverName}</span>}{event.comment && <span>{event.comment}</span>}{event.reason && <span>{event.reason}</span>}</li>)}</ol>
    </section>}
  </>;
}
