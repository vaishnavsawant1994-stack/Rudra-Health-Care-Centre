"use client";
import { useEffect, useState, type FormEvent } from "react";

type RoleRow = { id: string; role: string; key: string; scope: "CENTRE" | "ORGANIZATION"; permission: string | null; description: string | null };
type Permission = { key: string; description: string; scope: "CENTRE" | "ORGANIZATION" };
type Role = { id: string; name: string; key: string; scope: RoleRow["scope"]; permissionKeys: string[] };
function readRoleCatalog(body: { roles?: RoleRow[]; permissions?: Permission[] }) {
  const grouped = new Map<string, Role>();
  for (const row of body.roles ?? []) { const role = grouped.get(row.id) ?? { id: row.id, name: row.role, key: row.key, scope: row.scope, permissionKeys: [] }; if (row.permission) role.permissionKeys.push(row.permission); grouped.set(row.id, role); }
  return { roles: [...grouped.values()], permissions: body.permissions ?? [] };
}
export function RolePermissionManager({ canManage }: { canManage: boolean }) {
  const [roles, setRoles] = useState<Role[]>([]); const [catalog, setCatalog] = useState<Permission[]>([]); const [state, setState] = useState("Loading roles and permissions…"); const [busy, setBusy] = useState("");
  useEffect(() => {
    let live = true;
    const refresh = () => fetch("/api/admin/roles", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json() })).then(({ response, body }) => { if (!live) return; if (!response.ok) { setState(`Role catalog unavailable (${body.error ?? response.status}).`); return; } const result = readRoleCatalog(body); setRoles(result.roles); setCatalog(result.permissions); setState(result.roles.length ? "" : "No roles are configured."); }).catch(() => { if (live) setState("Role service unavailable."); });
    fetch("/api/admin/roles", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json() })).then(({ response, body }) => { if (!live) return; if (!response.ok) { setState(`Role catalog unavailable (${body.error ?? response.status}).`); return; } const result = readRoleCatalog(body); setRoles(result.roles); setCatalog(result.permissions); setState(result.roles.length ? "" : "No roles are configured."); }).catch(() => { if (live) setState("Role service unavailable."); });
    window.addEventListener("rudra-admin-data-refresh", refresh);
    return () => { live = false; window.removeEventListener("rudra-admin-data-refresh", refresh); };
  }, []);
  async function save(role: Role, formData: FormData) { const permissionKeys = catalog.filter((permission) => formData.get(permission.key) === "on").map((permission) => permission.key); setBusy(role.id); setState(""); try { const response = await fetch("/api/admin/roles", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ roleId: role.id, permissionKeys }) }); const body = await response.json(); if (!response.ok) { setState(`Role update rejected (${body.error ?? response.status}).`); return; } setState(`${role.name} grants saved.`); window.dispatchEvent(new Event("rudra-admin-data-refresh")); } catch { setState("Role update service unavailable."); } finally { setBusy(""); } }
  function submit(role: Role) { return (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); void save(role, new FormData(event.currentTarget)); }; }
  return <>{state ? <p role="status">{state}</p> : null}{roles.map((role) => <section className="admin-card" key={role.id}><h2>{role.name}</h2><p>{role.scope === "CENTRE" ? "Centre-scoped" : "Organization-wide"} · <code>{role.key}</code></p><p className="record-id">Role UUID: <code>{role.id}</code></p><form className="permission-grid" onSubmit={submit(role)}><fieldset disabled={!canManage || role.key === "owner_super_admin" || busy === role.id}><legend>Permissions</legend>{catalog.filter((permission) => role.scope === "ORGANIZATION" || permission.scope === "CENTRE").map((permission) => <label className="permission-option" key={permission.key}><input type="checkbox" name={permission.key} defaultChecked={role.permissionKeys.includes(permission.key)} /><span><strong>{permission.key}</strong><small>{permission.description}</small></span></label>)}</fieldset>{canManage ? role.key === "owner_super_admin" ? <p className="setup-notice">The owner super-admin role is immutable.</p> : <button className="button button-secondary" disabled={busy === role.id}>{busy === role.id ? "Saving…" : "Save permissions"}</button> : null}</form></section>)}</>;
}
