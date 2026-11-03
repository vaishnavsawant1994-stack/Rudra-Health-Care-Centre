import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const { getApiAccess } = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));

describe("specimen collection API boundary", () => {
  beforeEach(() => getApiAccess.mockReset());
  const payload = { action: "collect", jobId: "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5", specimenType: "Synthetic tube", requirementReference: "SYNTHETIC-SOP-1", identityCheckConfirmed: true, procedureApprovalId: "a8bad75c-b226-46d8-b238-86501998dd41", reason: "Synthetic collection verification" };
  const req = (key?: string, origin = "http://localhost") => new Request("http://localhost/api/samples", { method: "POST", headers: { origin, "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: JSON.stringify(payload) });
  it("does not return sample directory data to signed-out or MFA-incomplete sessions", async () => {
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    expect((await GET(new Request("http://localhost/api/samples"))).status).toBe(401);
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    const response = await GET(new Request("http://localhost/api/samples"));
    expect(response.status).toBe(428);
    expect(await response.json()).toEqual({ error: "mfa_setup_required" });
    expect(getApiAccess).toHaveBeenCalledTimes(2);
  });
  it("rejects unknown queue views after requiring an authorized sample session", async () => {
    getApiAccess.mockResolvedValueOnce({ staff: { grants: [] }, response: null });
    const response = await GET(new Request("http://localhost/api/samples?view=patient-identities"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_sample_view" });
  });
  it("validates and rechecks a selected centre before querying samples", async () => {
    const centreId = "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5";
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    expect((await GET(new Request(`http://localhost/api/samples?centreId=${centreId}`))).status).toBe(403);
    expect(getApiAccess).toHaveBeenCalledWith("samples.read", centreId);
    getApiAccess.mockResolvedValueOnce({ staff: { grants: [] }, response: null });
    const invalid = await GET(new Request("http://localhost/api/samples?centreId=not-a-uuid"));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_centre" });
  });
  it("requires an idempotency key and rejects unauthenticated or MFA-incomplete requests", async () => {
    expect((await POST(req())).status).toBe(400);
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    expect((await POST(req("972b2aed-30f9-4c01-9473-b8db9a6db88c"))).status).toBe(401);
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    expect((await POST(req("df2d1773-3cfb-49f3-9370-d0b9d74389fe"))).status).toBe(428);
  });
  it("rejects cross-origin mutations before authorization or persistence", async () => {
    expect((await POST(req("df2d1773-3cfb-49f3-9370-d0b9d74389fe", "https://attacker.invalid"))).status).toBe(403);
    expect(getApiAccess).not.toHaveBeenCalled();
  });
});
