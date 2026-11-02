import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { getAppointmentReadAccess, getDb } = vi.hoisted(() => ({ getAppointmentReadAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/appointment-access", () => ({ getAppointmentReadAccess }));
vi.mock("@/db/client", () => ({ getDb }));

describe("appointment calendar pagination boundary", () => {
  beforeEach(() => { getAppointmentReadAccess.mockReset(); getDb.mockReset(); });

  it.each(["0", "-1", "1.5", "100001", "not-a-number"])("rejects invalid page %s before auth or database access", async (page) => {
    const response = await GET(new Request(`http://localhost/api/appointments/calendar?centreId=00000000-0000-4000-8000-000000000001&date=2026-10-30&page=${page}`));
    expect(response.status).toBe(400);
    expect(getAppointmentReadAccess).not.toHaveBeenCalled();
    expect(getDb).not.toHaveBeenCalled();
  });
});
