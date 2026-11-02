"use client";
import Link from "next/link";
import { useEffect, useState } from "react";

type StaffRow = { id: string; staffCode: string; displayName: string; status: string; isOwner: boolean; twoFactorEnabled: boolean };
export function StaffDirectory() {
  const [rows, setRows] = useState<StaffRow[]>([]); const [state, setState] = useState("Loading staff records…");
  useEffect(() => { let live = true; const load = async () => { try { const response = await fetch("/api/admin/staff", { cache: "no-store" }); const body = await response.json(); if (!live) return; if (!response.ok) { setState(body.error === "setup_required" ? "Setup is required before staff records can load." : `Staff list unavailable (${body.error ?? response.status}).`); return; } setRows(body.staff ?? []); setState(body.staff?.length ? "" : "No staff records yet."); } catch { if (live) setState("Staff service unavailable."); } }; void load(); window.addEventListener("rudra-admin-data-refresh", load); return () => { live = false; window.removeEventListener("rudra-admin-data-refresh", load); }; }, []);
  return <section className="admin-card"><h2>Organization staff</h2>{state ? <p role="status">{state}</p> : <div className="table-scroll"><table className="admin-table"><thead><tr><th>Staff code</th><th>Name</th><th>Status</th><th>Authenticator</th><th>Profile</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}><td>{row.staffCode}</td><td>{row.displayName}{row.isOwner ? " · Owner" : ""}</td><td>{row.status}</td><td>{row.twoFactorEnabled ? "Enrolled" : "Required"}</td><td><Link href={`/owner/staff/${row.id}`}>Open</Link></td></tr>)}</tbody></table></div>}</section>;
}
