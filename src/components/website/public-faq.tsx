"use client";

import { useMemo, useState } from "react";
import { filterPublicFaq, type PublicFaqItem } from "@/lib/public-faq";

export function PublicFaq({ items }: { items: PublicFaqItem[] }) {
  const [query, setQuery] = useState("");
  const [topic, setTopic] = useState("ALL");
  const topics = useMemo(() => [...new Set(items.map((item) => item.topic))].sort((a, b) => a.localeCompare(b)), [items]);
  const visible = useMemo(() => filterPublicFaq(items, query, topic), [items, query, topic]);

  return <section aria-label="Frequently asked questions">
    <div className="public-faq-filters">
      <label>Search questions<input type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={100} placeholder="Search services, booking, privacy..." /></label>
      <label>Topic<select value={topic} onChange={(event) => setTopic(event.target.value)}><option value="ALL">All topics</option>{topics.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
    </div>
    <p role="status" aria-live="polite">{visible.length} {visible.length === 1 ? "answer" : "answers"} found.</p>
    {visible.length ? <dl className="public-faq">{visible.map((item) => <div key={`${item.topic}:${item.question}`}><dt>{item.question}</dt><dd>{item.answer}</dd></div>)}</dl> : <p className="public-faq-empty">No answers match those filters. Try another topic or search term.</p>}
  </section>;
}
