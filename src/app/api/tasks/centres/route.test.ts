import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";

const { getApiAccess, getDb } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));

describe("task centre selector authorization", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); });

  it("rejects unsupported selector views", async () => {
    const response = await GET(new Request("http://localhost/api/tasks/centres?view=all"));
    expect(response.status).toBe(400);
    expect(getApiAccess).not.toHaveBeenCalled();
  });

  it("keeps task creation centre lookup behind its separate permission", async () => {
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request("http://localhost/api/tasks/centres"));
    expect(response.status).toBe(403);
    expect(getApiAccess).toHaveBeenCalledWith("tasks.create");
    expect(getDb).not.toHaveBeenCalled();
  });

  it("requires task-read permission for the read-only centre filter", async () => {
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    const response = await GET(new Request("http://localhost/api/tasks/centres?view=read"));
    expect(response.status).toBe(403);
    expect(getApiAccess).toHaveBeenCalledWith("tasks.read");
    expect(getDb).not.toHaveBeenCalled();
  });
});
