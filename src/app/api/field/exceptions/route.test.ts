import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

import { GET, POST } from "./route";

describe("assigned field exception queue", () => {
  const centreId = "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5";
  const staffId = "5f8f3d2c-3d55-4bf4-8a37-fec87779e990";
  const query = { from: vi.fn(), innerJoin: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), offset: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    for (const method of [query.from, query.innerJoin, query.where, query.orderBy, query.limit]) method.mockReturnValue(query);
    query.offset.mockResolvedValue([{
      id: "exception-1", centreId, specimenId: "specimen-1", exceptionType: "DAMAGED", exceptionStatus: "OPEN",
      recordedAt: new Date("2026-11-04T09:00:00.000Z"), specimenNumber: "RHC-S-SYNTHETIC", specimenStatus: "EXCEPTION",
    }]);
    mocks.getDb.mockReturnValue({ select: vi.fn(() => query) });
    mocks.getApiAccess.mockResolvedValue({ response: null, staff: {
      organizationId: "org-1", staffUserId: staffId, grants: [{ key: "collections.visit.record", centreId }],
    } });
  });

  it("returns a minimal queue scoped to the current collector and permitted centre", async () => {
    const response = await GET(new Request("http://localhost/api/field/exceptions?page=1&pageSize=20"));
    expect(response.status).toBe(200);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("collections.visit.record", undefined);
    expect(query.where).toHaveBeenCalled();
    expect(query.limit).toHaveBeenCalledWith(21);
    const body = await response.json();
    expect(body.exceptions).toHaveLength(1);
    expect(body.exceptions[0]).toEqual({
      centreId, exceptionType: "DAMAGED", exceptionStatus: "OPEN",
      recordedAt: "2026-11-04T09:00:00.000Z", specimenNumber: "RHC-S-SYNTHETIC", specimenStatus: "EXCEPTION",
    });
    expect(JSON.stringify(body)).not.toMatch(/patient|order|privateData|reason|evidence|ciphertext/i);
  });

  it("denies unauthorized staff before querying exception records", async () => {
    mocks.getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request("http://localhost/api/field/exceptions"));
    expect(response.status).toBe(403);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects invalid centres and pagination before authorization or database access", async () => {
    expect((await GET(new Request("http://localhost/api/field/exceptions?centreId=bad"))).status).toBe(400);
    expect((await GET(new Request("http://localhost/api/field/exceptions?pageSize=101"))).status).toBe(400);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("supports an organization-wide permission while retaining assigned-staff filtering", async () => {
    mocks.getApiAccess.mockResolvedValueOnce({ response: null, staff: {
      organizationId: "org-1", staffUserId: staffId, grants: [{ key: "collections.visit.record", centreId: null }],
    } });
    // A global grant is represented by null; the API still constrains results to the signed-in staff ID.
    const response = await GET(new Request("http://localhost/api/field/exceptions"));
    expect(response.status).toBe(200);
    expect(mocks.getDb).toHaveBeenCalled();
  });

  it("returns both queue collections empty when the authorized staff member has no centre grants", async () => {
    mocks.getApiAccess.mockResolvedValueOnce({ response: null, staff: { organizationId: "org-1", staffUserId: staffId, grants: [] } });
    const response = await GET(new Request("http://localhost/api/field/exceptions"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ exceptions: [], eligibleSpecimens: [], page: 1, pageSize: 50, hasMore: false });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("validates field exception requests before database access and preserves authorization denials", async () => {
    const invalid = await POST(new Request("http://localhost/api/field/exceptions", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ centreId, specimenNumber: "SP-SYNTHETIC", expectedVersion: 1, type: "REJECTED", reason: "Synthetic test" }),
    }));
    expect(invalid.status).toBe(400);
    expect(mocks.getDb).not.toHaveBeenCalled();

    mocks.getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    const denied = await POST(new Request("http://localhost/api/field/exceptions", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "8bd86c5d-d772-4e59-8f6b-2c8343c9da55" },
      body: JSON.stringify({ centreId, specimenNumber: "SP-SYNTHETIC", expectedVersion: 1, type: "DAMAGED", reason: "Synthetic damage observed" }),
    }));
    expect(denied.status).toBe(428);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("collections.visit.record", centreId);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
