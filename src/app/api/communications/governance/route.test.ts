import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "./route";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

const centreId = "e72d4a66-cbe0-42de-9232-1e28e594590f";
const body = { centreId, recordKind: "PROVIDER_POLICY", channel: "WHATSAPP", idempotencyKey: "53e5e339-6d96-4a0b-97e0-596686eaa2fa", privateData: { displayName: "Synthetic policy", languages: ["en"], quietHoursStart: "21:00", quietHoursEnd: "09:00", routingInstructions: "Escalate requests to authorized staff.", consentRequired: true, humanEscalation: true } };

describe("communications governance authorization boundary", () => {
  beforeEach(() => { mocks.getApiAccess.mockReset(); mocks.getDb.mockReset(); });

  it("requires centre filters and a valid record kind before accessing the database", async () => {
    const response = await GET(new Request("http://localhost/api/communications/governance?centreId=bad&recordKind=KNOWLEDGE"));
    expect(response.status).toBe(400);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("denies unauthorized draft reads at the requested centre", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request(`http://localhost/api/communications/governance?centreId=${centreId}&recordKind=KNOWLEDGE`));
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("configuration.read", centreId);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects a client attempt to disable consent before authorization or persistence", async () => {
    const invalid = { ...body, privateData: { ...body.privateData, consentRequired: false } };
    const response = await POST(new Request("http://localhost/api/communications/governance", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(invalid) }));
    expect(response.status).toBe(400);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("denies creation without configuration-manage permission and stores no provider secret", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await POST(new Request("http://localhost/api/communications/governance", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify(body) }));
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("configuration.manage", centreId);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
