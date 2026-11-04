import { describe, expect, it, vi } from "vitest";
import { loadBusinessRelationshipProfileFromAuthorizedCentres } from "./business-relationship-profile-navigation";

describe("business relationship profile deep-link resolution", () => {
  it("tries only authorized centres and returns the profile from its owning centre", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: "relationship_not_found" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ relationship: { id: "partner-2", centreId: "centre-2" } }));

    const result = await loadBusinessRelationshipProfileFromAuthorizedCentres<{ relationship: { id: string; centreId: string } }>(
      "partner-2",
      "PARTNER",
      [{ id: "centre-1" }, { id: "centre-2" }],
      fetcher,
    );

    expect(result).toEqual({ centreId: "centre-2", profile: { relationship: { id: "partner-2", centreId: "centre-2" } } });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/business-relationships/partner-2?centreId=centre-1&type=PARTNER",
      "/api/business-relationships/partner-2?centreId=centre-2&type=PARTNER",
    ]);
  });

  it("keeps missing and out-of-scope records indistinguishable", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "unavailable" }, { status: 403 }));
    await expect(loadBusinessRelationshipProfileFromAuthorizedCentres("unknown", "CORPORATE", [{ id: "allowed-centre" }], fetcher)).resolves.toBeNull();
  });

  it("fails closed on server errors and malformed successful responses", async () => {
    const unavailable = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}, { status: 503 }));
    await expect(loadBusinessRelationshipProfileFromAuthorizedCentres("corp", "CORPORATE", [{ id: "centre" }], unavailable)).rejects.toThrow("business_relationship_profile_unavailable");
    const malformed = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    await expect(loadBusinessRelationshipProfileFromAuthorizedCentres("corp", "CORPORATE", [{ id: "centre" }], malformed)).rejects.toThrow("business_relationship_profile_response_invalid");
  });
});
