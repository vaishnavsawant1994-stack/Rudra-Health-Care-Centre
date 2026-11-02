"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { usePublicCatalogueSearch } from "./use-public-catalogue-search";
import { PublicEnquiryForm } from "@/components/leads/public-enquiry-workbench";
type Choice = "catalogue" | "booking" | "collection" | "human";

const choices: Array<{ id: Choice; label: string }> = [
  { id: "catalogue", label: "Find a test or package" },
  { id: "booking", label: "Request a visit" },
  { id: "collection", label: "Ask about home collection" },
  { id: "human", label: "Contact the Rudra team" },
];

export function GuidedPublicAssistant() {
  const [choice, setChoice] = useState<Choice | null>(null);
  const [query, setQuery] = useState("");
  const searchState = usePublicCatalogueSearch();
  const { items, message, busy, hasMore } = searchState;

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await searchState.search(query);
  }

  function select(next: Choice) {
    setChoice(next);
    setQuery("");
    searchState.reset();
  }

  return <section className="guided-assistant" aria-labelledby="guided-assistant-title">
    <header><span className="eyebrow">Rudra service guide</span><h1 id="guided-assistant-title">How can we help you today?</h1><p>This guided assistant uses fixed choices and verified catalogue data. It is not an AI or medical-advice service. It does not save conversations or create bookings.</p></header>
    <div className="guided-assistant-log" role="log" aria-live="polite" aria-relevant="additions text">
      <p className="assistant-message"><strong>Rudra guide</strong> Choose a topic to see the right next step.</p>
      {choice === "booking" && <p className="assistant-message"><strong>Rudra guide</strong> You can send a visit request for staff review. The form does not confirm an appointment.<br /><Link href="/book">Open the visit request form</Link></p>}
      {choice === "collection" && <p className="assistant-message"><strong>Rudra guide</strong> Home collection depends on centre coverage, availability and service requirements. A request is not confirmed until Rudra reviews it.<br /><Link href="/home-collection">View home collection information</Link></p>}
      {choice === "human" && <GuidedPublicHumanHandoff />}
      {choice === "catalogue" && <p className="assistant-message"><strong>Rudra guide</strong> Enter only a test or package name. Do not enter personal or health information.</p>}
      {message && <p className="assistant-message" role="status"><strong>Rudra guide</strong> {message}</p>}
      {items.length > 0 && <ul className="guided-assistant-results">{items.map((item) => <li key={`${item.centreId}:${item.id}`}><span><strong>{item.displayName}</strong><small>{item.serviceType === "TEST" ? "Test" : "Package"} · {item.centreName}</small></span><span>{item.currency} {item.priceAmount}</span><Link href={`/${item.serviceType === "TEST" ? "tests" : "packages"}/${encodeURIComponent(item.id)}`}>View details</Link></li>)}</ul>}
      {items.length > 0 && hasMore && <button type="button" className="button button-secondary" disabled={busy} onClick={searchState.loadMore}>{busy ? "Loading…" : "Load more services"}</button>}
    </div>
    {choice === "catalogue" && <form className="guided-assistant-search" onSubmit={(event) => void search(event)}><label htmlFor="guided-service-query">Test or package name<input id="guided-service-query" autoComplete="off" minLength={2} maxLength={80} required value={query} onChange={(event) => { setQuery(event.target.value); searchState.reset(); }} /></label><button className="button button-primary" disabled={busy || query.trim().length < 2}>{busy ? "Searching…" : "Search verified catalogue"}</button></form>}
    <nav className="guided-assistant-choices" aria-label="Choose a service guide topic">{choices.map((item) => <button type="button" key={item.id} className={choice === item.id ? "button button-primary" : "button button-secondary"} aria-pressed={choice === item.id} onClick={() => select(item.id)}>{item.label}</button>)}</nav>
    <p className="public-catalogue-note">This guide does not provide diagnosis, report interpretation, confirmed availability, external messaging or patient-record access. Search terms are sent only to Rudra’s verified catalogue endpoint and are not saved.</p>
  </section>;
}

export function GuidedPublicHumanHandoff() {
  return <div className="assistant-message"><p><strong>Rudra guide</strong> Send a service enquiry for staff review. Only information you submit is saved as an enquiry; it is not a booking, marketing opt-in, or permission for ongoing contact. Do not include symptoms, medical history or report details.</p><PublicEnquiryForm mode="inquiry" /></div>;
}
