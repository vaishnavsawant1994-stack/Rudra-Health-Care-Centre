"use client";

import { useEffect, useState } from "react";
import { TaskWorkbench } from "@/components/tasks/task-workbench";
import { isSupportTicketRecord } from "@/lib/support-ticket-access";
import type { PermissionGrant } from "@/server/permissions";

export function SupportTicketDetail({ id, staffId, grants }: { id: string; staffId: string; grants: PermissionGrant[] }) {
  const [state, setState] = useState<"loading" | "ready" | "unavailable">("loading");

  useEffect(() => {
    let active = true;
    void fetch(`/api/tasks/${encodeURIComponent(id)}`, { cache: "no-store" })
      .then(async (response) => ({ response, data: await response.json() as { task?: unknown } }))
      .then(({ response, data }) => {
        if (active) setState(response.ok && isSupportTicketRecord(data.task) ? "ready" : "unavailable");
      })
      .catch(() => { if (active) setState("unavailable"); });
    return () => { active = false; };
  }, [id]);

  if (state === "loading") return <section className="admin-card" role="status">Loading authorized support request…</section>;
  if (state === "unavailable") return <section className="admin-card" role="status">This support request is unavailable in your authorized scope.</section>;

  return <TaskWorkbench
    staffId={staffId}
    permissionGrants={grants}
    canCreate={false}
    canUpdate={grants.some((grant) => grant.key === "tasks.update" || grant.key === "tasks.support.manage")}
    canApprove={false}
    canAssign={grants.some((grant) => grant.key === "tasks.assign" || grant.key === "tasks.support.manage")}
    canEscalate={grants.some((grant) => grant.key === "escalations.create")}
    canFilterCentre={grants.some((grant) => grant.key === "tasks.read")}
    initialTaskType="SUPPORT_REQUEST"
    fixedTaskType="SUPPORT_REQUEST"
    initialTaskId={id}
  />;
}
