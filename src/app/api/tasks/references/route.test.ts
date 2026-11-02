import { beforeEach, describe, expect, it, vi } from "vitest";

const { getApiAccess } = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));

describe("task operational reference API", () => {
  beforeEach(() => getApiAccess.mockReset());

  it("requires source-domain permission for the requested centre", async () => {
    const { GET } = await import("./route");
    getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request(`http://localhost/api/tasks/references?centreId=${crypto.randomUUID()}&type=SAMPLE_EXCEPTION`));
    expect(response.status).toBe(403);
    expect(getApiAccess).toHaveBeenCalledWith("samples.read", expect.any(String));
  });

  it("rejects malformed reference queries before authorization", async () => {
    const { GET } = await import("./route");
    const response = await GET(new Request("http://localhost/api/tasks/references?centreId=bad&type=PATIENT"));
    expect(response.status).toBe(400);
    expect(getApiAccess).not.toHaveBeenCalled();
  });

  it.each(["0", "-1", "1.5", "100001", "bad"])("rejects invalid reference page %s before authorization", async (page) => {
    const { GET } = await import("./route");
    const centreId = crypto.randomUUID();
    const response = await GET(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=APPOINTMENT&page=${page}`));
    expect(response.status).toBe(400);
    expect(getApiAccess).not.toHaveBeenCalled();
  });

  it.each(["0", "101", "1.5", "bad"])("rejects invalid reference page size %s before authorization", async (pageSize) => {
    const { GET } = await import("./route");
    const centreId = crypto.randomUUID();
    const response = await GET(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=APPOINTMENT&pageSize=${pageSize}`));
    expect(response.status).toBe(400);
    expect(getApiAccess).not.toHaveBeenCalled();
  });

  it.each([["REPORT", "reports.read"], ["REPORT_FOLLOWUP", "reports.followups.manage"], ["LEAD_FOLLOWUP", "leads.followups.manage"], ["PUBLIC_ENQUIRY", "leads.read"], ["FINANCE_PAYMENT", "finance.read"], ["FINANCE_REFUND", "finance.read"]])("requires the source-domain grant for %s references", async (type, permission) => {
    const { GET } = await import("./route");
    const centreId = crypto.randomUUID();
    getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=${type}`));
    expect(response.status).toBe(403);
    expect(getApiAccess).toHaveBeenCalledWith(permission, centreId);
  });

  it("requires one of the scoped task read grants before listing task references", async () => {
    const { GET } = await import("./route");
    const centreId = crypto.randomUUID();
    getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=STAFF_TASK`));
    expect(response.status).toBe(403);
    expect(getApiAccess.mock.calls).toEqual([["tasks.read", centreId], ["tasks.assigned.read", centreId], ["tasks.support.read", centreId]]);
  });

  it("fails closed when neither broad nor assigned escalation access covers the requested centre", async () => {
    const { GET } = await import("./route");
    const centreId = crypto.randomUUID();
    getApiAccess.mockResolvedValue({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request(`http://localhost/api/tasks/references?centreId=${centreId}&type=STAFF_ESCALATION`));
    expect(response.status).toBe(403);
    expect(getApiAccess.mock.calls).toEqual([["escalations.read", centreId], ["escalations.assigned.read", centreId]]);
  });
});
