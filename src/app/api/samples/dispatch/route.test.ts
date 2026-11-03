import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { getApiAccess } = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));

describe("dispatch register read boundary", () => {
  beforeEach(() => getApiAccess.mockReset());

  it("rejects malformed centre filters before querying the database", async () => {
    const response = await GET(new Request("http://localhost/api/samples/dispatch?centreId=invalid"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_centre" });
    expect(getApiAccess).not.toHaveBeenCalled();
  });

  it("rechecks the requested centre before reading batches", async () => {
    const centreId = "1bcdcf23-77c8-4dfb-8ff7-1cf7d08f1a47";
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request(`http://localhost/api/samples/dispatch?centreId=${centreId}`));
    expect(response.status).toBe(403);
    expect(getApiAccess).toHaveBeenCalledWith("samples.read", centreId);
  });
});
