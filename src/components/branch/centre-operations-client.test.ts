import { afterEach, describe, expect, it, vi } from "vitest";
import { loadCentreOperationsSummary } from "./centre-operations-client";

afterEach(() => vi.unstubAllGlobals());

describe("centre operations summary client", () => {
  it("requests an uncached permission-scoped summary and returns its centre data", async () => {
    const centres = [{ id: "centre-a", code: "MAIN", name: "Synthetic Centre", timeZone: "Asia/Kolkata", metrics: {}, queue: [] }];
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ centres }) });
    vi.stubGlobal("fetch", fetchMock);

    await expect(loadCentreOperationsSummary()).resolves.toEqual(centres);
    expect(fetchMock).toHaveBeenCalledWith("/api/branch/operations", { cache: "no-store", signal: undefined });
  });

  it("fails closed on an unavailable or malformed summary response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    await expect(loadCentreOperationsSummary()).rejects.toThrow("summary_unavailable");

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ centres: "not-an-array" }) }));
    await expect(loadCentreOperationsSummary()).rejects.toThrow("summary_invalid_response");
  });
});
