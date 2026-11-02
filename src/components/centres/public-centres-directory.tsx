"use client";

import { useEffect, useMemo, useState } from "react";
import { filterPublicCentres } from "@/lib/public-centre-search";
import Link from "next/link";

type Centre = { id: string; code: string; name: string; publicProfile: null | { address: string | null; phone: string | null; email: string | null; serviceArea: string | null; openingHours: string | null } };

export function PublicCentresDirectory({ serviceAreasOnly = false }: { serviceAreasOnly?: boolean }) {
  const [centres, setCentres] = useState<Centre[]>([]);
  const [query, setQuery] = useState("");
  const [state, setState] = useState("Loading published centres…");

  useEffect(() => {
    let active = true;
    void fetch("/api/public/centres", { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (!active) return;
        if (!ok || !Array.isArray(body.centres)) throw new Error("centres_unavailable");
        setCentres(body.centres);
        setState(body.centres.length ? "" : "No active centres currently have a published public profile.");
      })
      .catch(() => { if (active) setState("The centre directory is temporarily unavailable. Try again later."); });
    return () => { active = false; };
  }, []);

  const visible = useMemo(() => {
    return filterPublicCentres(centres, query, serviceAreasOnly);
  }, [centres, query, serviceAreasOnly]);

  return <section className="public-centres" aria-label="Published Rudra centres">
    <label className="public-centres-search">{serviceAreasOnly ? "Search service areas or centres" : "Search centres"}<input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={80} placeholder={serviceAreasOnly ? "Area, centre name or code" : "Centre name or code"} /></label>
    {state && <p role="status">{state}</p>}
    {!state && visible.length === 0 && <p role="status">{serviceAreasOnly ? "No published service-area information matches this search." : "No published centres match this search."}</p>}
    {visible.length > 0 && <ul className="public-centres-list">{visible.map((centre) => <li key={centre.id}><span className="public-centre-mark" aria-hidden="true">R</span><span><strong>{centre.name}</strong><small>Centre code: {centre.code}</small>{centre.publicProfile?.address && <small>{centre.publicProfile.address}</small>}{centre.publicProfile?.serviceArea && <small>Service area: {centre.publicProfile.serviceArea}</small>}{centre.publicProfile?.openingHours && <small>Hours: {centre.publicProfile.openingHours}</small>}{centre.publicProfile?.phone && <small><a href={`tel:${encodeURIComponent(centre.publicProfile.phone)}`}>{centre.publicProfile.phone}</a></small>}{centre.publicProfile?.email && <small><a href={`mailto:${encodeURIComponent(centre.publicProfile.email)}`}>{centre.publicProfile.email}</a></small>}<Link href={`/centres/${encodeURIComponent(centre.id)}`}>Centre details and published services</Link></span>{serviceAreasOnly ? <a className="button button-secondary service-area-request" href={`/book?centreId=${encodeURIComponent(centre.id)}&visitType=HOME_COLLECTION`}>Request home collection</a> : <Link href={`/centres/${encodeURIComponent(centre.id)}`}>View centre</Link>}</li>)}</ul>}
  </section>;
}
