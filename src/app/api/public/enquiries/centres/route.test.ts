import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ listPublicEnquiryCentres: vi.fn() }));
vi.mock("@/server/public-enquiry-centres", () => ({ listPublicEnquiryCentres: mocks.listPublicEnquiryCentres }));

import { GET } from "./route";

describe("public enquiry centre directory", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only the minimal centre choices provided by the published-profile read model", async () => {
    mocks.listPublicEnquiryCentres.mockResolvedValue([{ id: "centre-public", code: "NORTH", name: "North Centre" }]);
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ centres: [{ id: "centre-public", code: "NORTH", name: "North Centre" }] });
  });

  it("returns a generic error when public centre profile data cannot be read", async () => {
    mocks.listPublicEnquiryCentres.mockRejectedValue(new Error("private database failure"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "public_enquiry_centres_unavailable" });
  });
});
