import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { getApiAccess } = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));

describe("sample detail authorization boundary", () => {
  beforeEach(() => getApiAccess.mockReset());

  it("does not resolve or expose a sample before authentication and MFA checks pass", async () => {
    const context = { params: Promise.resolve({ id: "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5" }) };
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    expect((await GET(new Request("http://localhost/api/samples/c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5"), context)).status).toBe(401);
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    const response = await GET(new Request("http://localhost/api/samples/c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5"), context);
    expect(response.status).toBe(428);
    expect(await response.json()).toEqual({ error: "mfa_setup_required" });
    expect(getApiAccess).toHaveBeenCalledTimes(2);
  });

  it("returns the same not-found response for malformed identifiers without lookup", async () => {
    const response = await GET(new Request("http://localhost/api/samples/not-a-uuid"), { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(getApiAccess).not.toHaveBeenCalled();
  });
});
