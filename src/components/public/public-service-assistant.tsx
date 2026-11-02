"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { usePublicCatalogueSearch } from "./use-public-catalogue-search";

export function PublicServiceAssistant() {
  const [query, setQuery] = useState("");
  const searchState = usePublicCatalogueSearch();
  const { items, message, busy, hasMore } = searchState;

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await searchState.search(query);
  }

  return <section className="public-service-assistant" aria-labelledby="service-assistant-title">
    <div className="section-heading"><div><span className="eyebrow">Service finder</span><h2 id="service-assistant-title">Find a published test or package</h2></div></div>
    <p>Search uses only the currently published, verified catalogue. This tool does not give medical advice, interpret reports, book appointments, or save your search.</p>
    <form className="public-service-assistant-form" onSubmit={(event) => void search(event)}>
      <label htmlFor="service-assistant-query">Test or package name<input id="service-assistant-query" autoComplete="off" maxLength={80} minLength={2} required value={query} onChange={(event) => { setQuery(event.target.value); searchState.reset(); }} placeholder="Enter a service name" /></label>
      <button className="button button-primary" disabled={busy || query.trim().length < 2}>{busy ? "Searching…" : "Search catalogue"}</button>
    </form>
    <p className="public-catalogue-note">Please don’t enter your name, contact details, symptoms, medical history, report information, or any other personal/health details.</p>
    {message && <p role="status" aria-live="polite">{message}</p>}
    {items.length > 0 && <ul className="public-service-assistant-results">{items.map((item) => <li key={`${item.centreId}:${item.id}`}><div><strong>{item.displayName}</strong><span>{item.serviceType === "TEST" ? "Test" : "Package"} · {item.centreName}</span></div><span>{item.currency} {item.priceAmount}</span><Link href={`/${item.serviceType === "TEST" ? "tests" : "packages"}/${encodeURIComponent(item.id)}`}>View details</Link></li>)}</ul>}
    {hasMore && <button className="button button-secondary" type="button" disabled={busy} onClick={searchState.loadMore}>{busy ? "Loading…" : "Load more services"}</button>}
    <div className="page-actions"><Link className="button button-secondary" href="/book">Booking information</Link><Link className="text-link" href="/contact">Ask the Rudra team</Link></div>
  </section>;
}
