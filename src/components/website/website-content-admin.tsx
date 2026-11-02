"use client";

import { useEffect, useState } from "react";
import { json } from "@/lib/http";

type Content = { title: string; summary: string; seoTitle?: string; seoDescription?: string; sections: Array<{ heading: string; body: string }> };
type ReviewStatus = "NOT_SUBMITTED" | "PENDING" | "APPROVED" | "CHANGES_REQUESTED";
type Page = { slug: string; draft: Content; published: Content | null; draftVersion: number; publishedVersion: number | null; publishedAt: string | null; reviewStatus: ReviewStatus; reviewVersion: number | null; reviewSubmittedByStaffId: string | null; reviewDecidedByStaffId: string | null; reviewDecidedAt: string | null; updatedAt: string };
type Version = { version: number; content: Content; actorStaffId: string; recordedAt: string };
type ReviewEvent = { action: string; reason?: string; eventType: string; recordedAt: string };
const slugs = ["home", "about", "home-collection", "faq", "corporate", "doctors", "partners", "centres", "service-areas", "tests", "packages", "booking", "contact"] as const;
const pageLinks: Record<(typeof slugs)[number], string> = { home: "/", about: "/about", "home-collection": "/home-collection", faq: "/faq", corporate: "/corporate", doctors: "/doctors", partners: "/partners", centres: "/centres", "service-areas": "/service-areas", tests: "/tests", packages: "/packages", booking: "/book", contact: "/contact" };
const blank: Content = { title: "", summary: "", seoTitle: "", seoDescription: "", sections: [{ heading: "", body: "" }] };

export function WebsiteContentAdmin({ canPublish, canReview }: { canPublish: boolean; canReview: boolean }) {
  const [pages, setPages] = useState<Page[]>([]); const [slug, setSlug] = useState<(typeof slugs)[number]>("home");
  const [content, setContent] = useState<Content>(blank); const [version, setVersion] = useState(0); const [published, setPublished] = useState<Content | null>(null);
  const [history, setHistory] = useState<Version[]>([]); const [reviewEvents, setReviewEvents] = useState<ReviewEvent[]>([]); const [historyMessage, setHistoryMessage] = useState("");
  const [preview, setPreview] = useState<"draft" | "published" | null>(null);
  const [message, setMessage] = useState("Loading website drafts…"); const [busy, setBusy] = useState(false);
  const selected = pages.find((page) => page.slug === slug);
  const reviewIsCurrent = selected?.reviewVersion === version;
  const canSubmit = Boolean(selected && !(selected.reviewStatus === "PENDING" && reviewIsCurrent) && !(selected.reviewStatus === "APPROVED" && reviewIsCurrent));
  useEffect(() => { let active = true;
    fetch("/api/admin/website-content", { cache: "no-store" }).then(async (response) => {
      const body = await response.json() as { pages?: Page[] };
      if (!active) return;
      if (!response.ok) { setMessage("Website content could not be loaded. Check your access and retry."); return; }
      const list = body.pages ?? []; setPages(list); const item = list.find((page) => page.slug === slug);
      setContent(item?.draft ?? blank); setVersion(item?.draftVersion ?? 0); setPublished(item?.published ?? null); setMessage(list.length ? "Drafts loaded." : "No drafts yet. Create a draft to begin.");
    }).catch(() => { if (active) setMessage("Website content service is unavailable. Retry when connected."); });
    return () => { active = false; };
  }, [slug]);
  function selectPage(next: (typeof slugs)[number]) { setSlug(next); const item = pages.find((page) => page.slug === next); setContent(item?.draft ?? blank); setVersion(item?.draftVersion ?? 0); setPublished(item?.published ?? null); setPreview(null); setMessage(""); }
  function updateSection(index: number, key: "heading" | "body", value: string) { setContent((current) => ({ ...current, sections: current.sections.map((section, i) => i === index ? { ...section, [key]: value } : section) })); }
  function loadVersionAsDraft(item: Version) {
    if (!window.confirm(`Load saved version ${item.version} into the editor? This replaces unsaved edits. The public page will not change unless you save and complete review.`)) return;
    setContent(item.content); setPreview(null); setMessage(`Version ${item.version} loaded into the editor. Save it to create a new version; it must be reviewed before publication.`);
  }
  async function submit(action: "SAVE_DRAFT" | "SUBMIT_REVIEW" | "APPROVE_REVIEW" | "REQUEST_CHANGES" | "PUBLISH" | "UNPUBLISH", reason?: string) {
    setBusy(true); setMessage("Saving…");
    try {
      const { response, body } = await json<{ page?: Page; error?: string }>("/api/admin/website-content", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ slug, action, ...(action === "SAVE_DRAFT" ? { content } : {}), ...(reason ? { reason } : {}), expectedVersion: version }) });
      if (!response.ok || !body.page) {
        const errors: Record<string, string> = { version_conflict: "This draft changed in another session. Reload before editing.", forbidden: "Your role does not have permission for this content action.", already_published: "This draft version is already public.", review_required: "Submit this draft and receive independent editorial approval before publishing.", review_not_pending: "This version is not awaiting review.", review_not_available: "This version cannot be submitted for review.", independent_review_required: "A different staff member must review the current draft.", review_reason_required: "Enter a reason for the review decision." };
        setMessage(errors[body.error ?? ""] ?? "The content action failed. Check the fields and your permissions."); return;
      }
      const page = body.page; setPages((current) => [...current.filter((item) => item.slug !== slug), page].sort((a, b) => a.slug.localeCompare(b.slug))); setContent(page.draft); setVersion(page.draftVersion); setPublished(page.published);
      const messages: Record<typeof action, string> = { SAVE_DRAFT: "Draft saved as a new version. Any prior review was invalidated.", SUBMIT_REVIEW: "Draft submitted for independent editorial review. This is not clinical, legal, pricing or franchise approval.", APPROVE_REVIEW: "Editorial review approved for this draft version. Publishing remains a separate Owner action.", REQUEST_CHANGES: "Changes requested. This version is not approved for publication.", PUBLISH: "Approved website content published.", UNPUBLISH: "Published page is no longer public." };
      setMessage(messages[action]);
      if (action !== "SAVE_DRAFT") setHistoryMessage("Reload review history to see the new event.");
    } catch { setMessage("Website content service is unavailable. Refresh before retrying."); } finally { setBusy(false); }
  }
  async function showHistory() {
    setHistoryMessage("Loading saved versions…");
    try {
      const { response, body } = await json<{ versions?: Version[]; events?: ReviewEvent[] }>(`/api/admin/website-content?slug=${encodeURIComponent(slug)}`);
      if (!response.ok) { setHistoryMessage("Version history is unavailable."); return; }
      setHistory(body.versions ?? []); setReviewEvents((body.events ?? []).filter((event) => event.eventType.startsWith("REVIEW_"))); setHistoryMessage(body.versions?.length ? "Saved versions and review events are listed newest first." : "No saved versions yet.");
    } catch { setHistoryMessage("Version history is unavailable."); }
  }
  function decideReview(action: "APPROVE_REVIEW" | "REQUEST_CHANGES") {
    const reason = window.prompt(action === "APPROVE_REVIEW" ? "Record the editorial review reason. Do not treat this as clinical, legal, pricing or franchise verification." : "Describe the requested change. Do not enter patient information.");
    if (reason?.trim()) void submit(action, reason.trim());
  }
  return <section className="admin-card">
    <h2>Public website content</h2><p>Structured text only. Drafts are encrypted. Public content requires independent editorial review and a separate Owner publication action. Do not enter patient information, unapproved legal terms, prices or clinical instructions.</p>
    <div className="admin-form"><label>Page<select value={slug} onChange={(event) => selectPage(event.target.value as (typeof slugs)[number])}>{slugs.map((item) => <option value={item} key={item}>{item}</option>)}</select></label>
      <label>Page title<input value={content.title} maxLength={120} onChange={(event) => setContent((current) => ({ ...current, title: event.target.value }))} /></label>
      <label>Short introduction<textarea rows={2} maxLength={300} value={content.summary} onChange={(event) => setContent((current) => ({ ...current, summary: event.target.value }))} /></label>
      <fieldset className="admin-card"><legend>Search metadata (optional)</legend><p>When blank, search engines use the page title and introduction. These fields follow the same independent review and Owner publish process as the page content.</p><label>Search title<input value={content.seoTitle ?? ""} maxLength={120} onChange={(event) => setContent((current) => ({ ...current, seoTitle: event.target.value }))} /></label><label>Search description<textarea rows={2} maxLength={300} value={content.seoDescription ?? ""} onChange={(event) => setContent((current) => ({ ...current, seoDescription: event.target.value }))} /></label></fieldset>
      {content.sections.map((section, index) => <fieldset className="admin-card" key={index}><legend>Section {index + 1}</legend><label>Heading<input value={section.heading} maxLength={120} onChange={(event) => updateSection(index, "heading", event.target.value)} /></label><label>Text<textarea rows={4} maxLength={1600} value={section.body} onChange={(event) => updateSection(index, "body", event.target.value)} /></label>{content.sections.length > 1 && <button type="button" className="button button-secondary" onClick={() => setContent((current) => ({ ...current, sections: current.sections.filter((_, i) => i !== index) }))}>Remove section</button>}</fieldset>)}
      {content.sections.length < 12 && <button type="button" className="button button-secondary" onClick={() => setContent((current) => ({ ...current, sections: [...current.sections, { heading: "", body: "" }] }))}>Add section</button>}
      <div className="actions"><button type="button" className="button button-primary" disabled={busy} onClick={() => void submit("SAVE_DRAFT")}>Save draft</button><button type="button" className="button button-secondary" disabled={busy || !selected || !canSubmit} onClick={() => void submit("SUBMIT_REVIEW")}>Submit draft for review</button>{canReview && selected?.reviewStatus === "PENDING" && reviewIsCurrent && <><button type="button" className="button button-secondary" disabled={busy} onClick={() => decideReview("APPROVE_REVIEW")}>Approve editorial review</button><button type="button" className="button button-secondary" disabled={busy} onClick={() => decideReview("REQUEST_CHANGES")}>Request changes</button></>}{canPublish && <><button type="button" className="button button-secondary" disabled={busy || !selected || selected.publishedVersion === version || selected.reviewStatus !== "APPROVED" || !reviewIsCurrent} onClick={() => void submit("PUBLISH")}>Publish approved draft</button><button type="button" className="button button-secondary" disabled={busy || !published} onClick={() => void submit("UNPUBLISH")}>Unpublish</button></>}</div>
      <p role="status">{message}</p><p>Draft version: {version}. Review status: {selected?.reviewStatus ?? "NOT_SUBMITTED"}{selected?.reviewVersion ? ` for version ${selected.reviewVersion}` : ""}. {published ? `Public version: ${selected?.publishedVersion ?? "—"} · ${selected?.publishedAt ? new Date(selected.publishedAt).toLocaleString() : ""}` : "No published version."}</p>{published && <p><a href={pageLinks[slug]}>Open public page</a></p>}
      <div className="actions"><button type="button" className="button button-secondary" onClick={() => setPreview(preview === "draft" ? null : "draft")}>{preview === "draft" ? "Close draft preview" : "Preview current draft"}</button>{published && <button type="button" className="button button-secondary" onClick={() => setPreview(preview === "published" ? null : "published")}>{preview === "published" ? "Close published preview" : "Preview published version"}</button>}</div>{preview && <article className="admin-card website-content-preview" aria-label={`${preview === "draft" ? "Draft" : "Published"} preview`}><p className="eyebrow">{preview === "draft" ? `Draft preview - version ${version}` : `Published preview - version ${selected?.publishedVersion ?? "unknown"}`}</p><h1>{(preview === "published" ? published : content)?.title}</h1><p>{(preview === "published" ? published : content)?.summary}</p>{(preview === "published" ? published : content)?.sections.map((section, index) => <section key={`${preview}-${index}`}><h2>{section.heading}</h2><p>{section.body}</p></section>)}</article>}
      <button type="button" className="button button-secondary" onClick={() => void showHistory()}>View saved versions and review history</button><p role="status">{historyMessage}</p>{history.map((item) => <details key={item.version}><summary>Draft version {item.version} · {new Date(item.recordedAt).toLocaleString()}</summary><h3>{item.content.title}</h3><p>{item.content.summary}</p>{item.content.sections.map((section, index) => <div key={`${item.version}-${index}`}><h4>{section.heading}</h4><p>{section.body}</p></div>)}<button type="button" className="button button-secondary" disabled={busy} onClick={() => loadVersionAsDraft(item)}>Load as new draft</button></details>)}{reviewEvents.map((event, index) => <details key={`${event.recordedAt}-${index}`}><summary>{event.eventType.replaceAll("_", " ")} · {new Date(event.recordedAt).toLocaleString()}</summary>{event.reason && <p>{event.reason}</p>}</details>)}
    </div>
  </section>;
}
