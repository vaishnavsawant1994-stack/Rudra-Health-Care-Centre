import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { openWebsiteContent, openWebsiteContentEvent, parsePublicContentSlug, publicContentSchema, sealWebsiteContent, sealWebsiteContentEvent } from "./website-content";

const value = { title: "Synthetic page", summary: "Synthetic introduction", sections: [{ heading: "Visit", body: "Ask our team for current information." }] };
const key = randomBytes(32).toString("base64");
afterEach(() => { delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; });
function configure() { process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ website_test: key }); process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "website_test"; }

describe("website content validation and encryption", () => {
  it("allows managed public information and service pages while rejecting legal-policy or arbitrary paths", () => { for (const slug of ["about", "corporate", "doctors", "partners", "centres", "service-areas", "tests", "packages", "booking", "contact"]) expect(parsePublicContentSlug(slug)).toBe(slug); expect(parsePublicContentSlug("privacy")).toBeNull(); expect(parsePublicContentSlug("terms")).toBeNull(); expect(parsePublicContentSlug("../owner")).toBeNull(); });
  it("validates the structured text model without accepting arbitrary fields", () => { expect(publicContentSchema.safeParse(value).success).toBe(true); expect(publicContentSchema.safeParse({ ...value, html: "<script>" }).success).toBe(false); });
  it("round-trips encrypted content and binds it to the organization and page", () => {
    configure(); const organizationId = randomUUID(); const pageId = randomUUID(); const envelope = sealWebsiteContent(organizationId, pageId, value);
    expect(envelope).not.toContain(value.title); expect(openWebsiteContent(organizationId, pageId, envelope)).toEqual(value);
    expect(() => openWebsiteContent(organizationId, randomUUID(), envelope)).toThrow("operational_data_integrity_failed");
    expect(() => openWebsiteContent(randomUUID(), pageId, envelope)).toThrow("operational_data_integrity_failed");
  });
  it("accepts optional bounded SEO metadata while keeping old page envelopes valid", () => {
    configure();
    const organizationId = randomUUID(); const pageId = randomUUID();
    const oldEnvelope = sealWebsiteContent(organizationId, pageId, value);
    expect(openWebsiteContent(organizationId, pageId, oldEnvelope)).toEqual(value);
    const updated = { ...value, seoTitle: "Synthetic search title", seoDescription: "A short synthetic search description." };
    expect(openWebsiteContent(organizationId, pageId, sealWebsiteContent(organizationId, pageId, updated))).toEqual(updated);
    expect(publicContentSchema.safeParse({ ...updated, seoTitle: "x".repeat(121) }).success).toBe(false);
  });
  it("encrypts editorial review reasons and binds review history to the event", () => {
    configure(); const organizationId = randomUUID(); const eventId = randomUUID(); const review = { slug: "about", version: 3, action: "REQUEST_CHANGES", reason: "Synthetic editorial comment" };
    const envelope = sealWebsiteContentEvent(organizationId, eventId, review);
    expect(envelope).not.toContain(review.reason);
    expect(openWebsiteContentEvent(organizationId, eventId, envelope)).toEqual(review);
    expect(() => openWebsiteContentEvent(organizationId, randomUUID(), envelope)).toThrow("operational_data_integrity_failed");
  });
});
