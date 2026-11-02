import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listPublicCatalogueCentres: vi.fn() }));
vi.mock("@/server/public-catalogue", () => ({ listPublicCatalogueCentres: mocks.listPublicCatalogueCentres }));

import { GET } from "./route";

describe("public published-centre API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only the centre list supplied by the published-catalogue read model", async () => {
    mocks.listPublicCatalogueCentres.mockResolvedValue([{ id: "centre-1", code: "MAIN", name: "Main Centre" }]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ centres: [{ id: "centre-1", code: "MAIN", name: "Main Centre" }] });
  });

  it("fails closed when the catalogue cannot be read", async () => {
    mocks.listPublicCatalogueCentres.mockRejectedValue(new Error("database unavailable"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "public_catalogue_unavailable" });
  });
});
