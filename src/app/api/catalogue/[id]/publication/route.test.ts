import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiAccess, getDb, appendAuditEvent, updateWhere } = vi.hoisted(() => ({
  getApiAccess: vi.fn(), getDb: vi.fn(), appendAuditEvent: vi.fn(), updateWhere: vi.fn(),
}));

vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));
vi.mock("@/server/audit", () => ({ appendAuditEvent }));
vi.mock("@/server/csrf", () => ({ isSameOriginRequest: () => true, csrfRejected: () => Response.json({ error: "csrf_rejected" }, { status: 403 }) }));
import { POST } from "./route";

const itemId = "c3000000-0000-4000-8000-000000000001";
const organizationId = "c3000000-0000-4000-8000-000000000002";
const centreId = "c3000000-0000-4000-8000-000000000003";
const staffId = "c3000000-0000-4000-8000-000000000004";
const item = { id: itemId, organizationId, centreId, currentVersion: 2, active: true, publicVisible: false };

function queryFor(rows: unknown[]) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  query.from = vi.fn(() => query); query.where = vi.fn(() => query); query.for = vi.fn(() => query);
  query.limit = vi.fn(async () => rows);
  return query;
}

function setup(options: { itemRows?: unknown[]; txRows?: unknown[][]; updateRows?: unknown[] } = {}) {
  const topQuery = queryFor(options.itemRows ?? [item]);
  const txQueries = [...(options.txRows ?? [[item], [{ id: "version-id" }]])];
  const tx = {
    select: vi.fn(() => queryFor(txQueries.shift() ?? [])),
    update: vi.fn(() => ({ set: vi.fn(() => ({ where: updateWhere.mockResolvedValue(options.updateRows ?? [item]) })) })),
  };
  getDb.mockReturnValue({ select: vi.fn(() => topQuery), transaction: (callback: (value: typeof tx) => unknown) => callback(tx) });
  getApiAccess.mockImplementation(async (_permission: string, _scope?: string) => ({ staff: { organizationId, staffUserId: staffId }, response: null }));
  appendAuditEvent.mockResolvedValue(undefined);
  updateWhere.mockReset();
  updateWhere.mockResolvedValue(options.updateRows ?? [item]);
  return tx;
}

function request(body: unknown) {
  return new Request("http://localhost/api/catalogue/publication", { method: "POST", headers: { "content-type": "application/json", origin: "http://localhost" }, body: JSON.stringify(body) });
}

describe("catalogue public publication authorization", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("does not read catalogue data without catalogue management authorization", async () => {
    getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await POST(request({ publicVisible: true, expectedVersion: 2 }), { params: Promise.resolve({ id: itemId }) });
    expect(response.status).toBe(403);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("fails closed when the current item version is not a verified effective price", async () => {
    const tx = setup({ txRows: [[item], []] });
    const response = await POST(request({ publicVisible: true, expectedVersion: 2 }), { params: Promise.resolve({ id: itemId }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "catalogue_not_publicable" });
    expect(tx.update).not.toHaveBeenCalled();
    expect(appendAuditEvent).not.toHaveBeenCalled();
  });

  it("publishes an eligible current version and appends an audit event", async () => {
    const tx = setup();
    const response = await POST(request({ publicVisible: true, expectedVersion: 2 }), { params: Promise.resolve({ id: itemId }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ publication: { publicVisible: true, changed: true, version: 2 } });
    expect(tx.update).toHaveBeenCalled();
    expect(appendAuditEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "catalogue.publication.enabled", entityId: itemId, details: { publicVisible: true, version: 2 } }));
  });

  it("rejects stale version requests without changing visibility", async () => {
    const tx = setup({ txRows: [[{ ...item, currentVersion: 3 }]] });
    const response = await POST(request({ publicVisible: true, expectedVersion: 2 }), { params: Promise.resolve({ id: itemId }) });
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "catalogue_changed" });
    expect(tx.update).not.toHaveBeenCalled();
  });
});
