import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealWebsiteContent } from "@/server/website-content";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

describe("public website content endpoint", () => {
  beforeEach(() => { mocks.getDb.mockReturnValue({ execute: vi.fn() }); });
  afterEach(() => { delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; });
  it("does not query the database for unsupported page paths", async () => {
    const { GET } = await import("./route"); const response = await GET(new Request("http://localhost/api/public/content/privacy"), { params: Promise.resolve({ slug: "privacy" }) });
    expect(response.status).toBe(404); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("fails closed when published content is absent or ambiguous across organizations", async () => {
    const { GET } = await import("./route");
    mocks.getDb.mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [] }) });
    expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ slug: "about" }) })).status).toBe(404);
    mocks.getDb.mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [{}, {}] }) });
    expect((await GET(new Request("http://localhost"), { params: Promise.resolve({ slug: "about" }) })).status).toBe(404);
  });
  it("serves only a uniquely published, authenticated-encrypted text payload", async () => {
    const organizationId = randomUUID(); const id = randomUUID(); const pageContent = { title: "Synthetic About", summary: "Synthetic intro", sections: [{ heading: "Visit", body: "Ask our team." }] };
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ route_test: randomBytes(32).toString("base64") }); process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "route_test";
    mocks.getDb.mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [{ id, organization_id: organizationId, slug: "about", published_ciphertext: sealWebsiteContent(organizationId, id, pageContent) }] }) });
    const { GET } = await import("./route"); const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ slug: "about" }) });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ slug: "about", content: pageContent }); expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("serves a published corporate information section", async () => {
    const organizationId = randomUUID(); const id = randomUUID(); const pageContent = { title: "Synthetic corporate information", summary: "Published by an authorized reviewer.", sections: [{ heading: "Coordination", body: "Contact Rudra to discuss verified centre information." }] };
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ route_test: randomBytes(32).toString("base64") }); process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "route_test";
    mocks.getDb.mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [{ id, organization_id: organizationId, slug: "corporate", published_ciphertext: sealWebsiteContent(organizationId, id, pageContent) }] }) });
    const { GET } = await import("./route"); const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ slug: "corporate" }) });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ slug: "corporate", content: pageContent });
  });
  it("serves encrypted published service-area information without replacing the live directory", async () => {
    const organizationId = randomUUID(); const id = randomUUID(); const pageContent = { title: "Synthetic service-area copy", summary: "Staff-reviewed information", sections: [{ heading: "Coverage", body: "Requests are reviewed by Rudra staff." }] };
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ route_test: randomBytes(32).toString("base64") }); process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "route_test";
    mocks.getDb.mockReturnValue({ execute: vi.fn().mockResolvedValue({ rows: [{ id, organization_id: organizationId, slug: "service-areas", published_ciphertext: sealWebsiteContent(organizationId, id, pageContent) }] }) });
    const { GET } = await import("./route"); const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ slug: "service-areas" }) });
    expect(response.status).toBe(200); expect(await response.json()).toEqual({ slug: "service-areas", content: pageContent });
  });
});
