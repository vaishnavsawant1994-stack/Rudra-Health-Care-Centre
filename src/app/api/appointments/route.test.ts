import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiAccess, getAppointmentReadAccess } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getAppointmentReadAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/server/appointment-access", () => ({ getAppointmentReadAccess }));
import { GET, POST } from "./route";

describe("appointment route authentication gate", () => {
  beforeEach(() => { getApiAccess.mockReset(); getAppointmentReadAccess.mockReset(); });

  it("rejects unauthenticated and MFA-incomplete appointment reads before querying records", async () => {
    getAppointmentReadAccess.mockResolvedValueOnce({ staff: null, assignedOnly: false, response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    expect((await GET(new Request("http://localhost/api/appointments"))).status).toBe(401);
    getAppointmentReadAccess.mockResolvedValueOnce({ staff: null, assignedOnly: false, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    expect((await GET(new Request("http://localhost/api/appointments"))).status).toBe(428);
    expect(getAppointmentReadAccess).toHaveBeenCalledTimes(2);
  });

  it("rejects unauthenticated and MFA-incomplete create requests before database access", async () => {
    const payload = { centreId: "e7a8b594-0c9b-4b71-a8e1-b7c2683a4a34", patientId: "0b191525-1f83-4490-9f46-578a217cafb0", visitType: "CENTRE", scheduledLocal: "2099-01-05T09:30", services: [{ type: "OTHER", name: "Synthetic service" }] };
    const requestFor = () => new Request("http://localhost/api/appointments", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": "6b6806c8-2353-4ac3-851b-21e3a7f9a48a" }, body: JSON.stringify(payload) });
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    expect((await POST(requestFor())).status).toBe(401);
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    expect((await POST(requestFor())).status).toBe(428);
    expect(getApiAccess).toHaveBeenCalledTimes(2);
  });

  it("rejects cross-origin mutations before checking or writing database records", async () => {
    const request = new Request("http://localhost/api/appointments", { method: "POST", headers: { origin: "http://attacker.invalid", "content-type": "application/json", "idempotency-key": "6b6806c8-2353-4ac3-851b-21e3a7f9a48a" }, body: "{}" });
    expect((await POST(request)).status).toBe(403);
    expect(getApiAccess).not.toHaveBeenCalled();
  });
});
