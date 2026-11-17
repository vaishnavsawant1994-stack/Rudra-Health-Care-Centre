"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { PermissionGrant } from "@/server/permissions";
import { RequestSequence } from "@/lib/request-sequence";

type Batch = { id: string; centreId: string; centreName?: string; batchNumber: string; status: string; carrierReference: string | null; externalLabReference: string | null; handedOverAt: string | null; createdAt: string };

export function filterDispatchBatchPage(batches: Batch[], mode: "handover" | "transit", grants: readonly PermissionGrant[]) {
  return batches.filter((batch) => {
    const visibleStatus = mode === "handover" ? batch.status === "PREPARING" : ["DISPATCHED", "RECEIPT_RECORDED"].includes(batch.status);
    const centreAllowed = grants.some((grant) => grant.key === "samples.read" && (grant.centreId === null || grant.centreId === batch.centreId));
    return visibleStatus && centreAllowed;
  });
}

export function DispatchBatchQueue({ mode, grants }: { mode: "handover" | "transit"; grants: readonly PermissionGrant[] }) {
  const [batches, setBatches] = useState<Batch[]>([]); const [message, setMessage] = useState("Loading dispatch batches…"); const [retry, setRetry] = useState(0); const [page, setPage] = useState(1); const [hasMore, setHasMore] = useState(false); const requests = useRef(new RequestSequence());
  useEffect(() => {
    const sequence = requests.current; const requestId = sequence.next(); const controller = new AbortController(); let active = true;
    void fetch(`/api/samples/dispatch?page=${page}&pageSize=25`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const body = await response.json() as { batches?: Batch[]; hasMore?: boolean };
      if (!active || !sequence.isCurrent(requestId)) return;
      if (!response.ok) { setMessage(response.status === 401 ? "Sign in to view dispatch batches." : response.status === 403 ? "Dispatch batch access is denied for your current role or centre." : "Dispatch queue is unavailable. Retry when the service is ready."); return; }
      setBatches(body.batches ?? []); setHasMore(body.hasMore === true); setMessage("");
    }).catch(() => { if (active && sequence.isCurrent(requestId)) setMessage("Dispatch queue could not be loaded. Retry before continuing."); });
    return () => { active = false; controller.abort(); sequence.invalidate(); };
  }, [page, requests, retry]);
  const visible = filterDispatchBatchPage(batches, mode, grants);
  const beginLoad = () => { setMessage("Loading dispatch batches…"); setBatches([]); setHasMore(false); };
  return <section className="admin-card"><p className="eyebrow">{mode === "handover" ? "L006 · Carrier handover" : "L007 · Shipment transit"}</p><h2>{mode === "handover" ? "Prepared batches awaiting handover" : "Recorded shipment milestones"}</h2><p>{mode === "handover" ? "Open a prepared batch to record the authorized carrier, transport procedure and actual handover." : "Only server-recorded handover and documentary receipt milestones are shown. GPS, courier acknowledgements, temperature compliance and destination processing are not inferred."}</p>{message ? <p role="status" aria-live="polite">{message} <button className="text-button" type="button" onClick={() => { beginLoad(); setRetry((value) => value + 1); }}>Retry</button></p> : visible.length ? <div className="table-scroll"><table className="admin-table"><thead><tr><th>Batch</th><th>Centre</th><th>Status</th><th>Carrier</th><th>External reference</th><th>Handed over</th><th>Action</th></tr></thead><tbody>{visible.map((batch) => <tr key={batch.id}><td>{batch.batchNumber}</td><td>{batch.centreName ?? "Authorized centre"}</td><td>{batch.status.replaceAll("_", " ")}</td><td>{batch.carrierReference ?? "Not recorded"}</td><td>{batch.externalLabReference ?? "Not recorded"}</td><td>{batch.handedOverAt ? new Date(batch.handedOverAt).toLocaleString() : "Not handed over"}</td><td><Link href={`/samples/dispatch/${batch.id}`}>{mode === "handover" ? "Open handover" : "Review evidence"}</Link></td></tr>)}</tbody></table></div> : <p role="status">{mode === "handover" ? "No prepared batches await carrier handover." : "No shipment events await review in the authorized scope."}</p>}<div className="action-row"><button className="button button-secondary" type="button" disabled={page <= 1} onClick={() => { beginLoad(); setPage((value) => Math.max(1, value - 1)); }}>Previous page</button><span aria-live="polite">Page {page}</span><button className="button button-secondary" type="button" disabled={!hasMore || Boolean(message)} onClick={() => { beginLoad(); setPage((value) => value + 1); }}>Next page</button></div></section>;
}
