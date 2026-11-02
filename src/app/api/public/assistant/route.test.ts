import { beforeEach, describe, expect, it, vi } from "vitest";

const { listPublicCatalogue } = vi.hoisted(() => ({ listPublicCatalogue: vi.fn() }));
vi.mock("@/server/public-catalogue", () => ({ listPublicCatalogue }));

import { POST } from "./route";

function request(body: unknown) { return new Request("http://localhost/api/public/assistant", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }

describe("public deterministic service finder", () => {
  beforeEach(() => vi.clearAllMocks());
  it("searches the verified public catalogue and returns only service-finder fields", async () => {
    listPublicCatalogue.mockResolvedValueOnce({ items: [{ id: "service-1", centreId: "centre-1", centreName: "Main Centre", serviceType: "TEST", serviceCode: "SYNTH-1", version: 2, displayName: "Synthetic profile", specimenRequirements: "private?", preparationInstructions: "private?", priceAmount: "250.00", currency: "INR", effectiveFrom: "2026-01-01", effectiveUntil: null }], page: 1, pageSize: 8, hasMore: false });
    const response = await POST(request({ query: "synthetic" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [{ id: "service-1", centreId: "centre-1", centreName: "Main Centre", serviceType: "TEST", displayName: "Synthetic profile", priceAmount: "250.00", currency: "INR" }], page: 1, hasMore: false });
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(listPublicCatalogue).toHaveBeenCalledWith({ query: "synthetic", page: 1, pageSize: 8 });
  });

  it("rejects empty, long, or unexpected inputs without querying the catalogue", async () => {
    for (const body of [{ query: " " }, { query: "x".repeat(81) }, { query: "cbc%" }, { query: "cbc", patientId: "private" }, { query: "cbc", page: 0 }, { query: "cbc", page: 2001 }]) {
      const response = await POST(request(body));
      expect(response.status).toBe(400);
    }
    expect(listPublicCatalogue).not.toHaveBeenCalled();
  });

  it("returns an empty result without inventing a match", async () => {
    listPublicCatalogue.mockResolvedValueOnce({ items: [], page: 1, pageSize: 8, hasMore: false });
    expect(await (await POST(request({ query: "unknown service" }))).json()).toEqual({ items: [], page: 1, hasMore: false });
  });

  it("supports bounded POST pagination without exposing search text in the URL", async () => {
    listPublicCatalogue.mockResolvedValueOnce({ items: [], page: 2, pageSize: 8, hasMore: true });
    const response = await POST(request({ query: "synthetic", page: 2 }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ items: [], page: 2, hasMore: true });
    expect(listPublicCatalogue).toHaveBeenCalledWith({ query: "synthetic", page: 2, pageSize: 8 });
  });

  it("fails closed with a generic response when the catalogue is unavailable", async () => {
    listPublicCatalogue.mockRejectedValueOnce(new Error("synthetic database outage"));
    const response = await POST(request({ query: "synthetic" }));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "service_search_unavailable" });
  });
});
