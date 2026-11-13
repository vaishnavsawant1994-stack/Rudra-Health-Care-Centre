"use client";

import { useEffect, useMemo, useState } from "react";
import { filterPublicCentres } from "@/lib/public-centre-search";
import { publicCentreDirectionsHref } from "@/lib/public-centre-links";
import Link from "next/link";

type Centre = { id: string; code: string; name: string; publicProfile: null | { address: string | null; phone: string | null; email: string | null; serviceArea: string | null; openingHours: string | null } };

export function PublicCentresDirectory({ serviceAreasOnly = false }: { serviceAreasOnly?: boolean }) {
  const [centres, setCentres] = useState<Centre[]>([]);
  const [query, setQuery] = useState("");
  const [state, setState] = useState("Loading published centres…");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/public/centres", { cache: "no-store", signal: controller.signal })
      .then(async (response) => ({ ok: response.ok, body: await response.json() }))
      .then(({ ok, body }) => {
        if (!ok || !Array.isArray(body.centres)) throw new Error("centres_unavailable");
        setCentres(body.centres);
        setState(body.centres.length ? "" : "No active centres currently have a published public profile.");
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setCentres([]);
        setState("The centre directory is temporarily unavailable. Try again later.");
      });
    return () => controller.abort();
  }, [reloadKey]);

  const visible = useMemo(() => {
    return filterPublicCentres(centres, query, serviceAreasOnly);
  }, [centres, query, serviceAreasOnly]);

  function retryDirectory() {
    setState("Loading published centres…");
    setCentres([]);
    setReloadKey((current) => current + 1);
  }

  return <section className="public-centres" aria-label="Published Rudra centres">
    <label className="public-centres-search">{serviceAreasOnly ? "Search service areas or centres" : "Search centres"}<input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={80} placeholder={serviceAreasOnly ? "Area, centre name or code" : "Centre name or code"} /></label>
    {state && <p role="status">{state}</p>}
    {state.includes("temporarily unavailable") && <button type="button" className="button button-secondary" onClick={retryDirectory}>Retry centre directory</button>}
    {!state && visible.length === 0 && <p role="status">{serviceAreasOnly ? "No published service-area information matches this search." : "No published centres match this search."}</p>}
    {visible.length > 0 && <ul className="public-centres-list">{visible.map((centre) => {
      const directionsHref = publicCentreDirectionsHref(centre.publicProfile?.address);
      return <li key={centre.id}><span className="public-centre-mark" aria-hidden="true">R</span><span><strong>{centre.name}</strong><small>Centre code: {centre.code}</small>{centre.publicProfile?.address && <small>{centre.publicProfile.address}</small>}{directionsHref && <small><a href={directionsHref} target="_blank" rel="noreferrer" aria-label={`Directions to ${centre.name} using the published address`}>Directions using published address</a></small>}{centre.publicProfile?.serviceArea && <small>Published service area: {centre.publicProfile.serviceArea}</small>}{centre.publicProfile?.openingHours && <small>Published hours: {centre.publicProfile.openingHours}</small>}{centre.publicProfile?.phone && <small><a href={`tel:${encodeURIComponent(centre.publicProfile.phone)}`}>{centre.publicProfile.phone}</a></small>}{centre.publicProfile?.email && <small><a href={`mailto:${encodeURIComponent(centre.publicProfile.email)}`}>{centre.publicProfile.email}</a></small>}<Link href={`/centres/${encodeURIComponent(centre.id)}`}>Centre details and published services</Link></span>{serviceAreasOnly ? <a className="button button-secondary service-area-request" href={`/book?centreId=${encodeURIComponent(centre.id)}&visitType=HOME_COLLECTION`}>Request home collection</a> : <Link href={`/centres/${encodeURIComponent(centre.id)}`}>View centre</Link>}</li>;
    })}</ul>}
  </section>;
}
