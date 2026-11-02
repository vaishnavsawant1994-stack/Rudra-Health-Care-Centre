import { Suspense, type ReactNode } from "react";
import { PageTitle } from "@/components/ui/page-title";
import { getPublishedWebsiteContent } from "@/server/public-website-content";

export function PublicContentOverride({ slug, fallback }: { slug: "home" | "about" | "home-collection" | "faq"; fallback: ReactNode }) {
  return <Suspense fallback={fallback}><PublishedContentOverride slug={slug} fallback={fallback} /></Suspense>;
}

async function PublishedContentOverride({ slug, fallback }: { slug: "home" | "about" | "home-collection" | "faq"; fallback: ReactNode }) {
  const content = await getPublishedWebsiteContent(slug);
  if (!content) return fallback;
  return <div className="inner-page"><div className="page-container"><PageTitle eyebrow="Rudra Health Care Centre" title={content.title} description={content.summary} />{content.sections.map((section, index) => <section className="admin-card" key={`${index}-${section.heading}`}><h2>{section.heading}</h2><p>{section.body}</p></section>)}</div></div>;
}

export function PublicContentSections({ slug, showTitle = true }: { slug: "corporate" | "doctors" | "partners" | "centres" | "service-areas" | "tests" | "packages" | "booking" | "contact"; showTitle?: boolean }) {
  return <Suspense fallback={null}><PublishedContentSections slug={slug} showTitle={showTitle} /></Suspense>;
}

async function PublishedContentSections({ slug, showTitle = true }: { slug: "corporate" | "doctors" | "partners" | "centres" | "service-areas" | "tests" | "packages" | "booking" | "contact"; showTitle?: boolean }) {
  const content = await getPublishedWebsiteContent(slug);
  if (!content) return null;
  return <section className="public-content-sections" aria-label={content.title}>
    {showTitle ? <PageTitle eyebrow="Rudra Health Care Centre" title={content.title} description={content.summary} /> : <p className="public-content-summary">{content.summary}</p>}
    {content.sections.map((section, index) => <section className="notice" key={`${index}-${section.heading}`}><h2>{section.heading}</h2><p>{section.body}</p></section>)}
  </section>;
}
