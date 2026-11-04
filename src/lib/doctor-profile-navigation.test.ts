import { describe, expect, it, vi } from "vitest";
import { loadDoctorProfileFromAuthorizedCentres } from "./doctor-profile-navigation";

describe("doctor profile deep-link resolution", () => {
  it("tries only authorized centres and returns the profile from its owning centre", async () => {
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json({ error: "doctor_not_found" }, { status: 404 }))
      .mockResolvedValueOnce(Response.json({ doctor: { id: "doctor-2", centreId: "centre-2" } }));

    const result = await loadDoctorProfileFromAuthorizedCentres<{ id: string; centreId: string }>(
      "doctor-2",
      [{ id: "centre-1" }, { id: "centre-2" }],
      fetcher,
    );

    expect(result).toEqual({ centreId: "centre-2", profile: { doctor: { id: "doctor-2", centreId: "centre-2" } } });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      "/api/doctors/doctor-2?centreId=centre-1",
      "/api/doctors/doctor-2?centreId=centre-2",
    ]);
  });

  it("returns the same unavailable result when no authorized centre owns the profile", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "doctor_not_found" }, { status: 404 }));
    await expect(loadDoctorProfileFromAuthorizedCentres("unknown", [{ id: "allowed-centre" }], fetcher)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails closed on service errors and malformed successful responses", async () => {
    const unavailable = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "unavailable" }, { status: 503 }));
    await expect(loadDoctorProfileFromAuthorizedCentres("doctor", [{ id: "centre" }], unavailable)).rejects.toThrow("doctor_profile_unavailable");

    const malformed = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
    await expect(loadDoctorProfileFromAuthorizedCentres("doctor", [{ id: "centre" }], malformed)).rejects.toThrow("doctor_profile_response_invalid");
  });
});
