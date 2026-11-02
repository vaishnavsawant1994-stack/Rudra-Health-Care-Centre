import { sql } from "drizzle-orm";
import { connection } from "next/server";
import { getDb } from "@/db/client";
import { openWebsiteContent, type PublicContent, type PublicContentSlug } from "@/server/website-content";
import type { Metadata } from "next";

type PublishedPage = { id: string; organization_id: string; published_ciphertext: string };

/**
 * Return only an unambiguous published page. A multi-organization database
 * must not select an arbitrary tenant's public content.
 */
export async function getPublishedWebsiteContent(slug: PublicContentSlug): Promise<PublicContent | null> {
  try {
    await connection();
    const result = await getDb().execute(sql`SELECT id, organization_id, published_ciphertext FROM website_content_pages WHERE slug = ${slug} AND published_ciphertext IS NOT NULL ORDER BY created_at ASC LIMIT 2`);
    const pages = (result as unknown as { rows?: PublishedPage[] }).rows ?? [];
    if (pages.length !== 1) return null;
    const page = pages[0];
    return openWebsiteContent(page.organization_id, page.id, page.published_ciphertext);
  } catch {
    // Public pages retain their reviewed static fallback during DB/key outages.
    return null;
  }
}

/** Use only the current, unambiguous published copy for crawler metadata. */
export async function getPublishedWebsiteMetadata(slug: PublicContentSlug, fallback: Metadata): Promise<Metadata> {
  const content = await getPublishedWebsiteContent(slug);
  return content ? {
    ...fallback,
    title: content.seoTitle || content.title,
    description: content.seoDescription || content.summary,
  } : fallback;
}
