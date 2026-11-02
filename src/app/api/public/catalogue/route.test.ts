import { beforeEach, describe, expect, it, vi } from "vitest";

const { listPublicCatalogue } = vi.hoisted(() => ({ listPublicCatalogue: vi.fn() }));
vi.mock("@/server/public-catalogue", () => ({ listPublicCatalogue }));

describe("public catalogue pagination API", () => {
  beforeEach(() => listPublicCatalogue.mockReset());

  it("returns the bounded page and continuation state", async () => {
    listPublicCatalogue.mockResolvedValue({ items: [{ id: "service-a" }], page: 3, pageSize: 25, hasMore: true });
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/public/catalogue?serviceType=TEST&centreId=10000000-0000-4000-8000-000000000001&q=glucose&page=3&pageSize=25"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [{ id: "service-a" }], page: 3, pageSize: 25, hasMore: true });
    expect(listPublicCatalogue).toHaveBeenCalledWith({ centreId: "10000000-0000-4000-8000-000000000001", serviceType: "TEST", query: "glucose", page: 3, pageSize: 25 });
  });

  it("rejects invalid bounds before querying the catalogue", async () => {
    const { GET } = await import("./route");
    for (const query of ["page=0", "page=2001", "pageSize=101", "pageSize=0", "unknown=x"]) {
      const response = await GET(new Request(`http://localhost/api/public/catalogue?${query}`));
      expect(response.status).toBe(400);
    }
    expect(listPublicCatalogue).not.toHaveBeenCalled();
  });
});
