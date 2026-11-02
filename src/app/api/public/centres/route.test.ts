import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listPublicCentres: vi.fn() }));
vi.mock("@/server/public-enquiry-centres", () => ({ listPublicCentres: mocks.listPublicCentres }));

import { GET } from "./route";

describe("public centre directory API", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the public directory projection without caching", async () => {
    mocks.listPublicCentres.mockResolvedValue([{ id: "centre-1", code: "NORTH", name: "North Centre", publicProfile: { address: "Public synthetic address", phone: null, email: null, serviceArea: "North district", openingHours: null } }]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ centres: [{ id: "centre-1", code: "NORTH", name: "North Centre", publicProfile: { serviceArea: "North district" } }] });
  });

  it("does not leak database details when the directory is unavailable", async () => {
    mocks.listPublicCentres.mockRejectedValue(new Error("private database error"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "public_centres_unavailable" });
  });
});
