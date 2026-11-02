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
  const [state, setState] = useState("Loading verified services…");
  const requestSequence = useRef(0);
  const load = useCallback(async (pageNumber = 1, append = false) => {
    const requestId = ++requestSequence.current;
    setState("Loading verified services…");
    try {
      const params = new URLSearchParams({ serviceType, page: String(pageNumber), pageSize: "50" });
      if (centreId) params.set("centreId", centreId);
      if (appliedQuery) params.set("q", appliedQuery);
      const [listResponse, listBody] = await fetch(`/api/public/catalogue?${params}`, { cache: "no-store" }).then(async (response) => [response, await response.json()] as const);
      if (requestId !== requestSequence.current) return;
      if (!listResponse.ok) throw new Error("catalogue_unavailable");
      const nextItems: PublicItem[] = listBody.items ?? [];
      setItems((current) => append ? [...current, ...nextItems.filter((item) => !current.some((existing) => existing.id === item.id))] : nextItems);
      setPage(pageNumber); setHasMore(listBody.hasMore ?? false);
      setState(append ? "" : nextItems.length ? "" : "No currently published, verified services match this view.");
    } catch {
      if (requestId !== requestSequence.current) return;
      if (!append) { setItems([]); setState("The service catalogue is temporarily unavailable. Try again later."); }
      else setState("More catalogue items could not be loaded. Retry to continue.");
    }
    finally { if (requestId === requestSequence.current) setLoadingMore(false); }
  }, [appliedQuery, centreId, serviceType]);
  useEffect(() => {
    let current = true;
    const initialCentre = new URLSearchParams(window.location.search).get("centreId");
    void fetch("/api/public/catalogue/centres", { cache: "no-store" }).then(async (response) => ({ response, body: await response.json() })).then(({ response, body }) => {
      if (!current) return;
      if (response.ok) setCentres(body.centres ?? []);
      if (initialCentre && Array.isArray(body.centres) && body.centres.some((centre: Centre) => centre.id === initialCentre)) setCentreId(initialCentre);
    }).catch(() => { if (current) setCentres([]); });
    return () => { current = false; };
  }, []);
  useEffect(() => { void Promise.resolve().then(() => load()); }, [load]);
  useEffect(() => () => { requestSequence.current += 1; }, []);
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setAppliedQuery(query.trim()); }
  return <section className="public-catalogue" aria-label={serviceType === "TEST" ? "Diagnostic tests" : "Diagnostic packages"}>
    <form className="public-catalogue-controls" onSubmit={submit}>
      <label>Centre<select value={centreId} onChange={(event) => setCentreId(event.target.value)}><option value="">All available centres</option>{centres.map((centre) => <option key={centre.id} value={centre.id}>{centre.name}</option>)}</select></label>
      <label>Search by service name or code<input value={query} onChange={(event) => setQuery(event.target.value)} maxLength={80} /></label>
      <button className="button button-primary" type="submit">Search</button>
    </form>
    {state && <p role="status">{state}</p>}
    {items.length > 0 && <div className="service-grid">{items.map((item) => <article className="service-card" key={item.id}>
      <span className="eyebrow">{item.serviceType === "TEST" ? "Diagnostic test" : "Diagnostic package"} · {item.serviceCode}</span>
      <strong>{item.displayName}</strong>
      <p>{item.centreName}</p>
      <p className="public-catalogue-price">{item.currency === "INR" ? "₹" : `${item.currency} `}{item.priceAmount}</p>
      {item.specimenRequirements && <p><b>Specimen:</b> {item.specimenRequirements}</p>}
      {item.preparationInstructions && <p><b>Preparation:</b> {item.preparationInstructions}</p>}
      <small>Verified price · effective from {item.effectiveFrom}{item.effectiveUntil ? ` through ${item.effectiveUntil}` : ""}</small>
      <p><Link className="button button-secondary" href={`/${serviceType === "TEST" ? "tests" : "packages"}/${item.id}`}>View details</Link></p>
    </article>)}</div>}
    {hasMore && <button type="button" className="button button-secondary" disabled={loadingMore} onClick={() => void load(page + 1, true)}>{loadingMore ? "Loading more services…" : "Load more services"}</button>}
    <p className="public-catalogue-note">Prices shown are published, source-reviewed catalogue prices for the selected centre and effective dates. Rudra home-collection service charges, if applicable, are separate.</p>
  </section>;
}
