import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/db/client", () => ({ getDb: mocks.getDb }));

import { resolveTaskReference } from "./task-reference";

const centreId = "2e4f4285-a7f0-4581-b707-9aa93854ad3a";
const staffId = "18ac692b-0f7f-4a54-8a1b-61e907cb69d8";
const jobId = "4ab627d7-c320-4bf2-9aa4-4a3caea7ad2e";

describe("collection-job task references", () => {
  beforeEach(() => vi.resetAllMocks());

  function configureAssignedJob(assignedStaffId: string | null) {
    mocks.getApiAccess
      .mockResolvedValueOnce({ response: Response.json({ error: "forbidden" }, { status: 403 }) })
      .mockResolvedValueOnce({ staff: { organizationId: "synthetic-org", staffUserId: staffId, grants: [{ key: "collections.visit.record", centreId }] } });
    const query = { from: vi.fn(), where: vi.fn(), limit: vi.fn().mockResolvedValue([{ number: "RHC-C-TEST", status: "ASSIGNED", assignedStaffId }]) };
    query.from.mockReturnValue(query);
    query.where.mockReturnValue(query);
    mocks.getDb.mockReturnValue({ select: vi.fn().mockReturnValue(query) });
  }

  it("resolves an assigned job using the narrow visit permission", async () => {
    configureAssignedJob(staffId);

    await expect(resolveTaskReference(
      { organizationId: "synthetic-org", staffUserId: staffId, grants: [{ key: "collections.visit.record", centreId }] },
      centreId,
      { type: "COLLECTION_JOB", id: jobId },
    )).resolves.toBe("RHC-C-TEST · ASSIGNED");

    expect(mocks.getApiAccess).toHaveBeenNthCalledWith(1, "collections.read", centreId);
    expect(mocks.getApiAccess).toHaveBeenNthCalledWith(2, "collections.visit.record", centreId);
  });

  it("does not resolve another worker's job through visit-only access", async () => {
    configureAssignedJob("other-synthetic-staff");

    await expect(resolveTaskReference(
      { organizationId: "synthetic-org", staffUserId: staffId, grants: [{ key: "collections.visit.record", centreId }] },
      centreId,
      { type: "COLLECTION_JOB", id: jobId },
    )).resolves.toBeNull();
  });

  it("does not query job details when both scoped permissions are denied", async () => {
    mocks.getApiAccess.mockResolvedValue({ response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const select = vi.fn();
    mocks.getDb.mockReturnValue({ select });

    await expect(resolveTaskReference(
      { organizationId: "synthetic-org", staffUserId: staffId, grants: [] },
      centreId,
      { type: "COLLECTION_JOB", id: jobId },
    )).resolves.toBeNull();

    expect(mocks.getApiAccess).toHaveBeenCalledTimes(2);
    expect(select).not.toHaveBeenCalled();
  });
});
