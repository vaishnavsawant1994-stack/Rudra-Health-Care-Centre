import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getPublicCatalogueItem: vi.fn() }));
vi.mock("@/server/public-catalogue", () => ({ getPublicCatalogueItem: mocks.getPublicCatalogueItem }));
import { GET } from "./route";

describe("public catalogue detail API", () => {
  beforeEach(() => vi.clearAllMocks());
  const context = (id: string) => ({ params: Promise.resolve({ id }) });

  it("returns the public detail model for an eligible item", async () => {
    const item = { id: "10000000-0000-4000-8000-000000000001", serviceType: "PACKAGE", includedTests: [] };
    mocks.getPublicCatalogueItem.mockResolvedValue(item);
    const response = await GET(new Request(`http://localhost/api/public/catalogue/${item.id}`), context(item.id));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ item });
  });

  it("does not reveal whether an ineligible or malformed item exists", async () => {
    mocks.getPublicCatalogueItem.mockResolvedValue(null);
    const hidden = await GET(new Request("http://localhost"), context("10000000-0000-4000-8000-000000000002"));
    const malformed = await GET(new Request("http://localhost"), context("not-a-uuid"));
    expect(hidden.status).toBe(404);
    expect(malformed.status).toBe(404);
    expect(await hidden.json()).toEqual({ error: "catalogue_item_not_found" });
    expect(mocks.getPublicCatalogueItem).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the catalogue is unavailable", async () => {
    mocks.getPublicCatalogueItem.mockRejectedValue(new Error("database unavailable"));
    const response = await GET(new Request("http://localhost"), context("10000000-0000-4000-8000-000000000001"));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "public_catalogue_unavailable" });
  });
});
