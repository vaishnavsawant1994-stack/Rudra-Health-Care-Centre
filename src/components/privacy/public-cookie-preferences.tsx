"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { parsePublicCookiePreferences, publicCookiePreferencesKey, serializePublicCookiePreferences, type PublicCookiePreferences } from "@/lib/public-cookie-preferences";

const defaults: PublicCookiePreferences = { analytics: false, marketing: false };

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener("rudra:public-cookie-preferences", callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener("rudra:public-cookie-preferences", callback);
  };
}

function getStoredPreference() {
  try { return window.localStorage.getItem(publicCookiePreferencesKey) ?? ""; }
  catch { return ""; }
}

export function PublicCookiePreferencesControl() {
  const stored = useSyncExternalStore(subscribe, getStoredPreference, () => "");
  const preferences = parsePublicCookiePreferences(stored) ?? defaults;
  const [saved, setSaved] = useState(false);

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const selection = { analytics: formData.get("analytics") === "on", marketing: formData.get("marketing") === "on" };
    try {
      window.localStorage.setItem(publicCookiePreferencesKey, serializePublicCookiePreferences(selection));
      window.dispatchEvent(new Event("rudra:public-cookie-preferences"));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }

  function necessaryOnly() {
    try {
      window.localStorage.setItem(publicCookiePreferencesKey, serializePublicCookiePreferences(defaults));
      window.dispatchEvent(new Event("rudra:public-cookie-preferences"));
      setSaved(true);
    } catch {
      setSaved(false);
    }
  }

  return <details className="public-cookie-preferences">
    <summary>Cookie preferences</summary>
    <form key={stored} onSubmit={save}>
      <p>Necessary security and session storage may be used to operate Rudra services. Optional analytics and marketing providers are not connected. Saving these local preferences does not enable tracking or activate an external service.</p>
      <label><input type="checkbox" checked disabled readOnly /> Necessary operation (always active)</label>
      <label><input type="checkbox" name="analytics" defaultChecked={preferences.analytics} /> Analytics preference (provider unavailable)</label>
      <label><input type="checkbox" name="marketing" defaultChecked={preferences.marketing} /> Marketing preference (provider unavailable)</label>
      <div className="page-actions"><button className="button button-primary" type="submit">Save preferences on this device</button><button className="button button-secondary" type="button" onClick={necessaryOnly}>Use necessary only</button></div>
      <p role="status" aria-live="polite">{saved ? "Your preference is saved on this device. Optional providers remain disabled." : "Preferences are stored only in this browser and are not sent to Rudra."}</p>
      <small>Draft privacy controls; final cookie wording and policy require Rudra approval.</small>
    </form>
  </details>;
}
