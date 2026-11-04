"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { collectionOperationsQuery } from "@/lib/collection-operations-query";
import { localCalendarDate } from "@/server/collection-schedule-policy";

type RouteJob = {
  id: string;
  jobNumber: string;
  patientName: string;
  patientLastName: string;
  visitType: string;
  status: string;
  visitStage?: "TRAVELLING" | "ARRIVED" | null;
  scheduledStart: string;
  scheduledEnd: string;
  centreTimeZone: string;
};

function jobTime(job: RouteJob) {
  return new Intl.DateTimeFormat(undefined, {
    timeStyle: "short",
    timeZone: job.centreTimeZone,
    timeZoneName: "short",
  }).format(new Date(job.scheduledStart));
}

export function FieldRouteBoard() {
  const [date, setDate] = useState(() => localCalendarDate(new Date()));
  const [jobs, setJobs] = useState<RouteJob[]>([]);
  const [message, setMessage] = useState("Loading your assigned visits…");

  useEffect(() => {
    let active = true;
    const params = collectionOperationsQuery({
      page: 1,
      pageSize: 100,
      centreId: "",
      scheduleDate: date,
      includeScheduleDate: true,
      assignedToMe: true,
    });
    void fetch(`/api/collections?${params}`, { cache: "no-store" })
      .then(async (response) => ({ response, body: await response.json() as { jobs?: RouteJob[]; error?: string; hasMore?: boolean } }))
      .then(({ response, body }) => {
        if (!active) return;
        if (!response.ok) {
          setMessage(body.error?.replaceAll("_", " ") ?? "Your route is unavailable. Retry from your collection workspace.");
          return;
        }
        const rows = body.jobs ?? [];
        setJobs(rows);
        setMessage(rows.length ? "" : "No visits are assigned to you for this date.");
        if (body.hasMore) setMessage("More than 100 visits are assigned for this date. Use My collection assignments to page through the full list.");
      })
      .catch(() => { if (active) setMessage("Your route could not be loaded. Check the connection and try again."); });
    return () => { active = false; };
  }, [date]);

  return <>
    <section className="notice"><span className="notice-icon" aria-hidden="true">i</span><div><h2>Time-ordered assignments</h2><p>This list is sorted by appointment time. It does not provide GPS directions, travel-time estimates or an optimized route. Open a visit to see its authorized address and instructions.</p></div></section>
    <section className="admin-card">
      <label htmlFor="field-route-date">Schedule date</label>
      <input id="field-route-date" type="date" value={date} onChange={(event) => { setJobs([]); setMessage("Loading your assigned visits…"); setDate(event.target.value); }} />
      {message ? <p role="status" aria-live="polite">{message}</p> : <ol className="field-route-list">{jobs.map((job) => <li className="admin-card" key={job.id}>
        <p><strong>{jobTime(job)}</strong> · {job.visitType.replaceAll("_", " ")}</p>
        <h3>{job.patientName} {job.patientLastName}</h3>
        <p>{job.jobNumber} · {job.status.replaceAll("_", " ")}{job.visitStage ? ` · ${job.visitStage.replaceAll("_", " ")}` : ""}</p>
        <Link className="button-link" href={`/collections/${job.id}`}>Open visit details and authorized directions</Link>
      </li>)}</ol>}
    </section>
  </>;
}
