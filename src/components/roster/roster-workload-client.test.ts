import { describe, expect, it, vi } from "vitest";
import { fetchRosterWorkload } from "./roster-workload-client";

describe("fetchRosterWorkload", () => {
  const from = new Date("2026-11-02T00:00:00.000Z");
  const to = new Date("2026-11-09T00:00:00.000Z");

  it("requests a non-cached centre and date-scoped workload and returns both views", async () => {
    const payload = { staff: [{ id: "staff-1", name: "Synthetic Staff", staffCode: "S-1", appointments: 2, collections: 1, openTasks: 0, scheduledMinutes: 420, unavailablePeriods: 0, appointmentsOutsideRoster: 0, collectionsOutsideRoster: 0, assignmentsDuringUnavailability: 0 }], dailyWorkload: [{ staffId: "staff-1", day: "2026-11-02", appointments: 2, collections: 1 }] };
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));

    await expect(fetchRosterWorkload("centre / 1", from, to, fetcher)).resolves.toEqual(payload);
    const [url, options] = fetcher.mock.calls[0];
    const query = new URL(String(url), "http://localhost").searchParams;
    expect(query.get("centreId")).toBe("centre / 1");
    expect(query.get("from")).toBe(from.toISOString());
    expect(query.get("to")).toBe(to.toISOString());
    expect(options).toEqual({ cache: "no-store" });
  });

  it("rejects an authorization or server failure instead of representing it as an empty workload", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 403 }));
    await expect(fetchRosterWorkload("centre-1", from, to, fetcher)).rejects.toThrow("roster_workload_unavailable");
  });

  it("rejects malformed payloads", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ staff: [] }));
    await expect(fetchRosterWorkload("centre-1", from, to, fetcher)).rejects.toThrow("roster_workload_invalid_response");
  });
});
