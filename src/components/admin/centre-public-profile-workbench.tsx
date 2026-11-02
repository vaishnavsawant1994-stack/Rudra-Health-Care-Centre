"use client";

import { useEffect, useState } from "react";

type Centre = { id: string; code: string; name: string; timeZone: string; status: string };
type Profile = { displayName: string; address: string | null; phone: string | null; email: string | null; serviceArea: string | null; openingHours: string | null; published: boolean };
const blank: Profile = { displayName: "", address: null, phone: null, email: null, serviceArea: null, openingHours: null, published: false };

export function CentrePublicProfileWorkbench() {
  const [centres, setCentres] = useState<Centre[]>([]);
  const [centreId, setCentreId] = useState("");
  const [profile, setProfile] = useState<Profile>(blank);
  const [version, setVersion] = useState(0);
  const [message, setMessage] = useState("Loading authorized centres…");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/admin/centres", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (!active) return;
        if (!response.ok || !Array.isArray(body.centres)) throw new Error();
        setCentres(body.centres);
        setCentreId(body.centres[0]?.id ?? "");
        setMessage(body.centres.length ? "Choose a centre to review its separately managed public profile." : "No centre is available in your scope.");
      }).catch(() => { if (active) setMessage("Could not load authorized centres."); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!centreId) return;
    let active = true;
    void fetch(`/api/admin/centres/${encodeURIComponent(centreId)}/public-profile`, { cache: "no-store" }).then(async (response) => ({ response, body: await response.json() }))
      .then(({ response, body }) => {
        if (!active) return;
        if (!response.ok) throw new Error();
        setProfile(body.profile ?? { ...blank, displayName: centres.find((centre) => centre.id === centreId)?.name ?? "" });
        setVersion(body.versionNumber ?? 0);
        setMessage(body.profile ? "Profile loaded. Publishing is an explicit action." : "No profile saved yet. Existing centre address/contact data is not copied here.");
      }).catch(() => { if (active) setMessage("Profile unavailable for this centre."); });
    return () => { active = false; };
  }, [centreId, centres]);

  function update(field: keyof Profile, value: string | boolean) {
    setProfile((current) => ({ ...current, [field]: typeof value === "string" && value === "" ? null : value } as Profile));
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!centreId || saving) return;
    setSaving(true); setMessage("Saving…");
    try {
      const response = await fetch(`/api/admin/centres/${encodeURIComponent(centreId)}/public-profile`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: version, profile }),
      });
      const body = await response.json();
      if (!response.ok) { setMessage(body.error === "version_conflict" ? "Another update was saved. Reload this centre before editing again." : "Profile was not saved. Check the public address or service area before publishing."); return; }
      setVersion(body.versionNumber); setMessage(profile.published ? "Public profile saved and published." : "Public profile saved as unpublished.");
    } catch { setMessage("Service unavailable. No success was recorded."); }
    finally { setSaving(false); }
  }

  return <section className="admin-card">
    <h2>Public centre directory profile</h2>
    <p>Only information entered here is eligible for the public site. Existing centre records are never copied automatically.</p>
    <label>Centre<select value={centreId} onChange={(event) => setCentreId(event.target.value)}>{centres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name} ({centre.code})</option>)}</select></label>
    {centreId && <form onSubmit={save} className="admin-form">
      <label>Public display name<input required minLength={2} maxLength={120} value={profile.displayName} onChange={(event) => update("displayName", event.target.value)} /></label>
      <label>Public address<textarea maxLength={500} value={profile.address ?? ""} onChange={(event) => update("address", event.target.value)} /></label>
      <label>Public phone<input maxLength={40} value={profile.phone ?? ""} onChange={(event) => update("phone", event.target.value)} /></label>
      <label>Public email<input type="email" maxLength={254} value={profile.email ?? ""} onChange={(event) => update("email", event.target.value)} /></label>
      <label>Service area<input maxLength={300} value={profile.serviceArea ?? ""} onChange={(event) => update("serviceArea", event.target.value)} /></label>
      <label>Opening hours<input maxLength={500} value={profile.openingHours ?? ""} onChange={(event) => update("openingHours", event.target.value)} /></label>
      <label><input type="checkbox" checked={profile.published} onChange={(event) => update("published", event.target.checked)} /> Publish this profile on the public centre directory</label>
      <button type="submit" disabled={saving}>{saving ? "Saving…" : "Save public profile"}</button>
    </form>}
    <p role="status">{message}</p>
  </section>;
}
