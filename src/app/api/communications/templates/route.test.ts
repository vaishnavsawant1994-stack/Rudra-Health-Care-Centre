import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));
vi.mock("@/server/audit", () => ({ appendAuditEvent: vi.fn() }));
vi.mock("@/server/operational-crypto", () => ({ encryptOperationalData: vi.fn(() => "encrypted"), decryptOperationalData: vi.fn(() => ({ name: "Synthetic template", body: "Synthetic copy" })), operationalContext: vi.fn((value, recordType) => ({ ...value, recordType })), fingerprintOperationalRequest: vi.fn((value) => JSON.stringify(value)), verifyOperationalRequestFingerprint: vi.fn((value, fingerprint) => JSON.stringify(value) === fingerprint) }));
vi.mock("@/server/csrf", () => ({ isSameOriginRequest: (request: Request) => request.headers.get("origin") === new URL(request.url).origin, csrfRejected: () => Response.json({ error: "same_origin_required" }, { status: 403 }) }));

import { GET, POST } from "./route";

const centreId = "2c61e074-b10e-42be-a8d3-b2f9cf9c081d";

describe("communication template API access", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires a completed authenticated MFA session before listing templates", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "mfa_required" }, { status: 428 }) });
    const response = await GET(new Request(`http://localhost/api/communications/templates?centreId=${centreId}`));
    expect(response.status).toBe(428);
    expect(mocks.getApiAccess).toHaveBeenCalledWith("leads.followups.manage", centreId);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("hides an out-of-scope centre before querying template data", async () => {
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId: "org-a", grants: [{ key: "leads.followups.manage", centreId: "8d077abd-e14e-41f0-bced-90410704e41f" }] }, response: null });
    const response = await GET(new Request(`http://localhost/api/communications/templates?centreId=${centreId}`));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("rejects cross-origin creation and malformed content before writing", async () => {
    const crossOrigin = await POST(new Request(`http://localhost/api/communications/templates`, { method: "POST", headers: { origin: "https://invalid.example", "content-type": "application/json" }, body: "{}" }));
    expect(crossOrigin.status).toBe(403);
    const invalid = await POST(new Request("http://localhost/api/communications/templates", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ centreId, idempotencyKey: "2c61e074-b10e-42be-a8d3-b2f9cf9c081d", purpose: "MARKETING", channel: "EMAIL", name: "Synthetic", body: "{{unsupported}}" }) }));
    expect(invalid.status).toBe(400);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
  });
});
