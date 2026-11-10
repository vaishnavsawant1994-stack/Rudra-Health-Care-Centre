"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";

type Centre = { id: string; code: string; name: string };
type PublicItem = { id: string; centreId: string; centreName: string; serviceType: "TEST" | "PACKAGE"; serviceCode: string; version: number; displayName: string; specimenRequirements: string | null; preparationInstructions: string | null; priceAmount: string; currency: string; effectiveFrom: string; effectiveUntil: string | null };

export function PublicCatalogueDirectory({ serviceType }: { serviceType: "TEST" | "PACKAGE" }) {
  const [centres, setCentres] = useState<Centre[]>([]);
  const [centreId, setCentreId] = useState("");
  const [query, setQuery] = useState("");
  const [appliedQuery, setAppliedQuery] = useState("");
  const [items, setItems] = useState<PublicItem[]>([]);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [state, setState] = useState("Loading currently published services…");
  const requestSequence = useRef(0);

  const load = useCallback(async (pageNumber = 1, append = false) => {
    const requestId = ++requestSequence.current;
    setState("Loading currently published services…");
    try {
      const params = new URLSearchParams({ serviceType, page: String(pageNumber), pageSize: "24" });
      if (centreId) params.set("centreId", centreId);
      if (appliedQuery) params.set("q", appliedQuery);
      const [response, body] = await fetch(`/api/public/catalogue?${params}`, { cache: "no-store" }).then(async (res) => [res, await res.json()] as const);
      if (requestId !== requestSequence.current) return;
      if (!response.ok) throw new Error("catalogue_unavailable");
      const nextItems: PublicItem[] = body.items ?? [];
      setItems((current) => append ? [...current, ...nextItems.filter((item) => !current.some((existing) => existing.id === item.id))] : nextItems);
      setPage(pageNumber); setHasMore(body.hasMore ?? false);
      setState(append ? "" : nextItems.length ? "" : "No currently published, verified services match this view.");
    } catch {
      if (requestId !== requestSequence.current) return;
      if (!append) { setItems([]); setState("The service catalogue is temporarily unavailable. Try again later."); }
      else setState("More catalogue items could not be loaded. Retry to continue.");
    } finally { if (requestId === requestSequence.current) setLoadingMore(false); }
  }, [appliedQuery, centreId, serviceType]);

  useEffect(() => {
    let current = true;
    const params = new URLSearchParams(window.location.search);
    const initialCentre = params.get("centreId");
    const initialQuery = params.get("q") ?? "";
    void fetch("/api/public/catalogue/centres", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json() })).then(({ response, body }) => {
      if (!current) return;
      if (initialQuery) { setQuery(initialQuery); setAppliedQuery(initialQuery); }
      if (response.ok) setCentres(body.centres ?? []);
      if (initialCentre && Array.isArray(body.centres) && body.centres.some((centre: Centre) => centre.id === initialCentre)) setCentreId(initialCentre);
    }).catch(() => { if (current) setCentres([]); });
    return () => { current = false; };
  }, []);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);
  useEffect(() => () => { requestSequence.current += 1; }, []);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setAppliedQuery(query.trim()); }

  return <section className="public-catalogue ref-catalogue" aria-label={serviceType === "TEST" ? "Diagnostic tests" : "Diagnostic packages"}>
    <div className="ref-catalogue-banner"><div><span className="eyebrow">Rudra Health Care Centre</span><h1>{serviceType === "TEST" ? "Diagnostic Tests" : "Health Checkup Packages"}</h1><p>{serviceType === "TEST" ? "Explore published diagnostic test details and review centre-specific information." : "Browse published diagnostic packages and their current verified details."}</p><div className="ref-hero-points"><span>Current published records</span><span>Centre-specific details</span><span>Effective catalogue prices</span></div></div><div className={`ref-catalogue-art ${serviceType === "TEST" ? "is-test" : "is-package"}`} aria-hidden="true"/></div>
    <div className="ref-catalogue-layout">
      <aside className="ref-catalogue-aside"><h2>Browse</h2><Link href="/tests" aria-current={serviceType === "TEST" ? "page" : undefined}>Diagnostic tests</Link><Link href="/packages" aria-current={serviceType === "PACKAGE" ? "page" : undefined}>Health packages</Link><Link href="/centres">Choose a centre</Link><div><strong>Pricing information</strong><p>Prices shown in results come from the currently published catalogue record for that centre. Home-collection charges, if any, are separate.</p></div></aside>
      <div className="ref-catalogue-results">
        <form className="public-catalogue-controls" onSubmit={submit}>
          <label>Centre<select value={centreId} onChange={(event) => setCentreId(event.target.value)}><option value="">All available centres</option>{centres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name}</option>)}</select></label>
          <label>Search services<input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={80} placeholder="Search by name or service code" /></label>
          <button className="button button-primary" type="submit">Search</button>
        </form>
        <div className="ref-results-head"><h2>{items.length ? `${items.length}${hasMore ? "+" : ""} published ${serviceType === "TEST" ? "tests" : "packages"}` : "Published services"}</h2><span>Verified and in effect for the selected centre</span></div>
        {state && <p role="status" className="ref-inline-state">{state}</p>}
        {items.length > 0 && <div className="ref-directory-grid">{items.map((item, index) => <article className="ref-directory-card" key={item.id}>
          <div className={`ref-directory-art art-${index % 5} ${serviceType === "TEST" ? "is-test" : "is-package"}`} aria-hidden="true"/>
          <div className="ref-directory-body"><small>{item.serviceCode} · {item.centreName}</small><h3>{item.displayName}</h3>
            {item.specimenRequirements && <p><b>Specimen</b> {item.specimenRequirements}</p>}{item.preparationInstructions && <p><b>Preparation</b> {item.preparationInstructions}</p>}
            <strong className="ref-price">{item.currency === "INR" ? "₹" : `${item.currency} `}{item.priceAmount}</strong><small>Verified price · effective {item.effectiveFrom}{item.effectiveUntil ? ` through ${item.effectiveUntil}` : ""}</small>
            <div className="ref-actions"><Link className="button button-secondary" href={`/${serviceType === "TEST" ? "tests" : "packages"}/${encodeURIComponent(item.id)}`}>View details</Link><Link className="button button-primary" href={`/book?centreId=${encodeURIComponent(item.centreId)}&catalogueItemId=${encodeURIComponent(item.id)}&catalogueVersion=${item.version}&service=${encodeURIComponent(`${item.displayName} (${item.serviceCode})`)}`}>Request this service</Link></div>
          </div>
        </article>)}</div>}
        {hasMore && <button type="button" className="button button-secondary" disabled={loadingMore} onClick={() => void load(page + 1, true)}>{loadingMore ? "Loading more services…" : "Load more services"}</button>}
        <p className="public-catalogue-note">Prices shown are published, source-reviewed catalogue prices for the selected centre and effective dates. Rudra home-collection service charges, if applicable, are separate.</p>
      </div>
    </div>
  </section>;
}
