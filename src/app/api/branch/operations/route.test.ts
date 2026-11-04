import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { getApiAccess, getDb } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));

describe("centre operations API boundary", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); });

  it("rejects signed-out and MFA-incomplete requests before querying aggregate data", async () => {
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    expect((await GET()).status).toBe(401);
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    expect((await GET()).status).toBe(428);
    expect(getDb).not.toHaveBeenCalled();
  });

  it("omits team roster counts for a reader whose roster access is self-scoped", async () => {
    getApiAccess.mockResolvedValue({ staff: {
      organizationId: "org-1", staffUserId: "staff-1", grants: [{ key: "roster.read", centreId: "centre-1" }],
    } });
    const query = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([{ id: "centre-1", code: "MAIN", name: "Main Centre", timeZone: "Asia/Kolkata" }]),
    };
    const select = vi.fn(() => query);
    getDb.mockReturnValue({ select });

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(body.centres[0].metrics).not.toHaveProperty("scheduledStaff");
    expect(body.centres[0].metrics).not.toHaveProperty("staffUnavailable");
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("scopes a field worker's sample exception count and queue through assigned collection jobs", async () => {
    getApiAccess.mockResolvedValue({ staff: {
      organizationId: "org-1", staffUserId: "field-1", grants: [
        { key: "samples.read", centreId: "centre-1" },
        { key: "samples.collect", centreId: "centre-1" },
      ],
    } });
    const centreQuery = {
      from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([{ id: "centre-1", code: "MAIN", name: "Main Centre", timeZone: "Asia/Kolkata" }]),
    };
    const countQuery = {
      from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ value: 2 }]),
    };
    const queueQuery = {
      from: vi.fn().mockReturnThis(), innerJoin: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(), limit: vi.fn().mockResolvedValue([{ id: "exception-1", kind: "MISSING_LABEL", status: "OPEN", createdAt: new Date("2026-11-01T00:00:00Z") }]),
    };
    const select = vi.fn().mockReturnValueOnce(centreQuery).mockReturnValueOnce(countQuery).mockReturnValueOnce(queueQuery);
    getDb.mockReturnValue({ select });

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.centres[0].metrics.openExceptions).toBe(2);
    expect(body.centres[0].queue).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "SAMPLE_EXCEPTION", id: "exception-1", href: "/samples/exceptions?exceptionId=exception-1&centreId=centre-1" })]));
    expect(countQuery.innerJoin).toHaveBeenCalledTimes(2);
    expect(queueQuery.innerJoin).toHaveBeenCalledTimes(2);
  });

  it("includes an unsuccessful collection visit in the open queue for an authorized centre reader", async () => {
    getApiAccess.mockResolvedValue({ staff: {
      organizationId: "org-1", staffUserId: "manager-1", grants: [{ key: "collections.read", centreId: "centre-1" }],
    } });
    const centreQuery = {
      from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([{ id: "centre-1", code: "MAIN", name: "Main Centre", timeZone: "Asia/Kolkata" }]),
    };
    const countQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ value: 1 }]) };
    const workQuery = {
      from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{
        id: "job-1", number: "COL-0001", status: "UNSUCCESSFUL", scheduledStart: new Date("2026-11-04T05:00:00Z"),
      }]),
    };
    const select = vi.fn().mockReturnValueOnce(centreQuery).mockReturnValueOnce(countQuery).mockReturnValueOnce(workQuery);
    getDb.mockReturnValue({ select });

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.centres[0].metrics.activeCollections).toBe(1);
    expect(body.centres[0].queue).toEqual(expect.arrayContaining([expect.objectContaining({
      id: "job-1", kind: "COLLECTION", status: "UNSUCCESSFUL", title: "Unsuccessful collection needs follow-up",
    })]));
  });

  it("deep-links centre queue website enquiries to the exact centre-scoped record", async () => {
    getApiAccess.mockResolvedValue({ staff: {
      organizationId: "org-1", staffUserId: "reception-1", grants: [{ key: "leads.read", centreId: "centre-1" }],
    } });
    const centreQuery = {
      from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([{ id: "centre-1", code: "MAIN", name: "Main Centre", timeZone: "Asia/Kolkata" }]),
    };
    const countQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ value: 1 }]) };
    const enquiriesQuery = {
      from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: "enquiry-1", reference: "RHC-W-SYNTH-1", status: "PENDING_REVIEW", createdAt: new Date("2026-11-04T05:00:00Z") }]),
    };
    getDb.mockReturnValue({ select: vi.fn().mockReturnValueOnce(centreQuery).mockReturnValueOnce(countQuery).mockReturnValueOnce(enquiriesQuery) });

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.centres[0].metrics.pendingWebsiteEnquiries).toBe(1);
    expect(body.centres[0].queue).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: "WEBSITE_ENQUIRY", id: "enquiry-1", href: "/leads/public-enquiries?enquiryId=enquiry-1&centreId=centre-1",
    })]));
  });

  it("returns minimized open support-request counts only in the reader's centre scope", async () => {
    getApiAccess.mockResolvedValue({ staff: {
      organizationId: "org-1", staffUserId: "support-1", grants: [{ key: "tasks.support.read", centreId: "centre-1" }],
    } });
    const centreQuery = {
      from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockResolvedValue([{ id: "centre-1", code: "MAIN", name: "Main Centre", timeZone: "Asia/Kolkata" }]),
    };
    const countQuery = { from: vi.fn().mockReturnThis(), where: vi.fn().mockResolvedValue([{ value: 2 }]) };
    const supportRowsQuery = {
      from: vi.fn().mockReturnThis(), where: vi.fn().mockReturnThis(), orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockResolvedValue([{ id: "task-1", number: "RHC-T-SYNTH-1", status: "OPEN", dueAt: null, createdAt: new Date("2026-11-04T05:00:00Z") }]),
    };
    const select = vi.fn().mockReturnValueOnce(centreQuery).mockReturnValueOnce(countQuery).mockReturnValueOnce(supportRowsQuery);
    getDb.mockReturnValue({ select });

    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.centres).toHaveLength(1);
    expect(body.centres[0].metrics.openSupportRequests).toBe(2);
    expect(body.centres[0].queue).toEqual([expect.objectContaining({
      id: "task-1", kind: "SUPPORT_REQUEST", reference: "RHC-T-SYNTH-1", href: "/support/tickets/task-1",
    })]);
    expect(JSON.stringify(body)).not.toContain("patient");
    expect(select).toHaveBeenCalledTimes(3);
  });
});
