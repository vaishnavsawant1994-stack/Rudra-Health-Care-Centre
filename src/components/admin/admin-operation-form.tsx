"use client";
import { useState, type FormEvent } from "react";

export function AdminOperationForm({ endpoint, fields, submitLabel, method = "POST" }: { endpoint: string; fields: Array<{ name: string; label: string; required?: boolean; placeholder?: string; type?: "text" | "email" | "password"; minLength?: number; maxLength?: number }>; submitLabel: string; method?: "POST" | "PATCH" | "DELETE" }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const formElement = event.currentTarget; setPending(true); setMessage("");
    const form = new FormData(formElement); const body = Object.fromEntries(fields.map((field) => { const raw = String(form.get(field.name) ?? ""); const value = field.type === "password" ? raw : raw.trim(); return [field.name, value === "" && !field.required ? null : value]; }));
    try { const response = await fetch(endpoint, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json(); setMessage(response.ok ? "Saved successfully." : `Not saved: ${result.error ?? "request failed"}`); if (response.ok) { formElement.reset(); window.dispatchEvent(new Event("rudra-admin-data-refresh")); } }
    catch { setMessage("Not saved: service unavailable."); } finally { for (const key of Object.keys(body)) if (fields.some((field) => field.name === key && field.type === "password")) body[key] = ""; setPending(false); }
  }
  return <form className="admin-form" onSubmit={submit}>{fields.map((field) => <label key={field.name}>{field.label}<input name={field.name} type={field.type ?? "text"} required={field.required} placeholder={field.placeholder} minLength={field.minLength} maxLength={field.maxLength} autoComplete={field.type === "password" ? "new-password" : field.type === "email" ? "email" : "off"} /></label>)}<button className="button button-primary" disabled={pending}>{pending ? "Saving…" : submitLabel}</button><p role="status" aria-live="polite">{message}</p></form>;
}
