import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listPublicCatalogue, listPublicCatalogueCentres, connection } = vi.hoisted(() => ({ listPublicCatalogue: vi.fn(), listPublicCatalogueCentres: vi.fn(), connection: vi.fn() }));
vi.mock("@/server/public-catalogue", () => ({ listPublicCatalogue, listPublicCatalogueCentres }));
vi.mock("next/server", () => ({ connection }));

import sitemap from "./sitemap";
import robots from "./robots";

describe("public crawler metadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("NODE_ENV", "test");
    delete process.env.PUBLIC_SITE_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.BETTER_AUTH_URL;
  });
  afterEach(() => vi.unstubAllEnvs());

  it("lists only public routes and currently published catalogue records", async () => {
    listPublicCatalogueCentres.mockResolvedValue([{ id: "centre-1", code: "MAIN", name: "Main Centre", publicProfile: null }]);
    listPublicCatalogue.mockResolvedValueOnce({ items: [
      { id: "test-1", serviceType: "TEST" },
      { id: "package-1", serviceType: "PACKAGE" },
    ], page: 1, pageSize: 100, hasMore: false });
    const urls = (await sitemap()).map((entry) => entry.url);
    expect(urls).toContain("http://localhost:3000/centres/centre-1");
    expect(urls).toContain("http://localhost:3000/tests/test-1");
    expect(urls).toContain("http://localhost:3000/packages/package-1");
    expect(urls).toContain("http://localhost:3000/offers");
    expect(urls).not.toContain("http://localhost:3000/health-guides");
    expect(urls.some((url) => /\/(staff|owner|patients|families|api)(\/|$)/.test(new URL(url).pathname))).toBe(false);
    expect(listPublicCatalogue).toHaveBeenCalledWith({ page: 1, pageSize: 100 });
  });

  it("keeps public routes available if catalogue lookup fails", async () => {
    listPublicCatalogueCentres.mockRejectedValue(new Error("synthetic catalogue outage"));
    expect((await sitemap()).map((entry) => entry.url)).toContain("http://localhost:3000/");
  });

  it("does not publish crawler URLs when production canonical origin is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await sitemap()).toEqual([]);
    expect(robots().sitemap).toBeUndefined();
  });

  it("blocks patient, staff and operational paths from crawler indexing", () => {
    const policy = robots();
    expect(policy.rules).toMatchObject({ userAgent: "*", allow: "/" });
    const disallowed = policy.rules && !Array.isArray(policy.rules) ? policy.rules.disallow : [];
    expect(disallowed).toEqual(expect.arrayContaining(["/account", "/staff", "/owner", "/patients", "/families", "/api"]));
  });
});
