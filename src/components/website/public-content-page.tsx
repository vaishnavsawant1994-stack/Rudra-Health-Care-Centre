"use client";

import { useEffect, useState } from "react";
import { json } from "@/lib/http";

type PublicContent = { title: string; summary: string; sections: Array<{ heading: string; body: string }> };
export function PublicContentPage({ slug }: { slug: string }) {
  const [content, setContent] = useState<PublicContent | null>(null); const [message, setMessage] = useState("Loading page…");
  useEffect(() => { let active = true; void json<{ content?: PublicContent; error?: string }>(`/api/public/content/${encodeURIComponent(slug)}`).then(({ response, body }) => { if (!active) return; if (!response.ok || !body.content) { setMessage("This page is not currently available."); return; } setContent(body.content); setMessage(""); }).catch(() => { if (active) setMessage("This page is temporarily unavailable."); }); return () => { active = false; }; }, [slug]);
  if (!content) return <main className="inner-page"><div className="page-container"><p role="status">{message}</p></div></main>;
  return <main className="inner-page"><div className="page-container"><header className="page-title"><span className="eyebrow">Rudra Health Care Centre</span><h1>{content.title}</h1><p>{content.summary}</p></header>{content.sections.map((section, index) => <section className="admin-card" key={`${index}-${section.heading}`}><h2>{section.heading}</h2><p>{section.body}</p></section>)}</div></main>;
}
