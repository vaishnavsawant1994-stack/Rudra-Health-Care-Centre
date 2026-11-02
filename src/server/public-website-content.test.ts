import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execute } = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: () => ({ execute }) }));
vi.mock("next/server", () => ({ connection: vi.fn() }));

import { getPublishedWebsiteContent, getPublishedWebsiteMetadata } from "./public-website-content";
import { sealWebsiteContent } from "./website-content";

describe("public website server content", () => {
  const content = { title: "Synthetic published page", summary: "A reviewed synthetic summary.", sections: [{ heading: "Service information", body: "Contact the centre for current details." }] };
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ public_content_test: randomBytes(32).toString("base64") });
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "public_content_test";
  });
  afterEach(() => { delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; });

  it("decrypts and returns a single published page for server rendering", async () => {
    const organizationId = randomUUID(); const pageId = randomUUID();
    execute.mockResolvedValue({ rows: [{ id: pageId, organization_id: organizationId, published_ciphertext: sealWebsiteContent(organizationId, pageId, content) }] });
    await expect(getPublishedWebsiteContent("about")).resolves.toEqual(content);
  });

  it("uses published CMS title and summary for page metadata and preserves fallback on unavailable content", async () => {
    const organizationId = randomUUID(); const pageId = randomUUID();
    execute.mockResolvedValueOnce({ rows: [{ id: pageId, organization_id: organizationId, published_ciphertext: sealWebsiteContent(organizationId, pageId, content) }] });
    await expect(getPublishedWebsiteMetadata("about", { title: "Fallback title", description: "Fallback description" })).resolves.toEqual({ title: content.title, description: content.summary });
    execute.mockResolvedValueOnce({ rows: [] });
    await expect(getPublishedWebsiteMetadata("about", { title: "Fallback title", description: "Fallback description" })).resolves.toEqual({ title: "Fallback title", description: "Fallback description" });
  });

  it("uses reviewed published SEO overrides and falls back to the page title and summary when blank", async () => {
    const organizationId = randomUUID(); const pageId = randomUUID();
    const seoContent = { ...content, seoTitle: "Synthetic search title", seoDescription: "Synthetic search description." };
    execute.mockResolvedValueOnce({ rows: [{ id: pageId, organization_id: organizationId, published_ciphertext: sealWebsiteContent(organizationId, pageId, seoContent) }] });
    await expect(getPublishedWebsiteMetadata("about", { title: "Fallback", description: "Fallback" })).resolves.toEqual({ title: seoContent.seoTitle, description: seoContent.seoDescription });
    execute.mockResolvedValueOnce({ rows: [{ id: pageId, organization_id: organizationId, published_ciphertext: sealWebsiteContent(organizationId, pageId, { ...content, seoTitle: " ", seoDescription: " " }) }] });
    await expect(getPublishedWebsiteMetadata("about", { title: "Fallback", description: "Fallback" })).resolves.toEqual({ title: content.title, description: content.summary });
  });

  it("returns no content when no page or an ambiguous multi-organization page exists", async () => {
    execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{}, {}] });
    await expect(getPublishedWebsiteContent("about")).resolves.toBeNull();
    await expect(getPublishedWebsiteContent("about")).resolves.toBeNull();
  });

  it("fails closed to the page fallback on database or ciphertext errors", async () => {
    execute.mockRejectedValueOnce(new Error("database unavailable"));
    await expect(getPublishedWebsiteContent("about")).resolves.toBeNull();
    execute.mockResolvedValueOnce({ rows: [{ id: randomUUID(), organization_id: randomUUID(), published_ciphertext: "tampered" }] });
    await expect(getPublishedWebsiteContent("about")).resolves.toBeNull();
  });
});
