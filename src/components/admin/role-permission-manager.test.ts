import { describe, expect, it, vi } from "vitest";
import { fetchRoleCatalog, readRoleCatalog } from "./role-permission-manager";

describe("role and permission catalog loading", () => {
  it("groups grants by role and retains organization and centre scope", () => {
    const catalog = readRoleCatalog({
      roles: [
        { id: "role-1", role: "Reception", key: "reception", scope: "CENTRE", permission: "leads.read", description: "Read leads" },
        { id: "role-1", role: "Reception", key: "reception", scope: "CENTRE", permission: null, description: null },
      ],
      permissions: [{ key: "leads.read", description: "Read leads", scope: "CENTRE" }],
    });

    expect(catalog.roles).toEqual([{ id: "role-1", name: "Reception", key: "reception", scope: "CENTRE", permissionKeys: ["leads.read"] }]);
    expect(catalog.permissions[0].scope).toBe("CENTRE");
  });

  it("makes one no-store request and passes cancellation through to fetch", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ roles: [], permissions: [] }), { status: 200, headers: { "content-type": "application/json" } }));

    await expect(fetchRoleCatalog(controller.signal, fetcher)).resolves.toEqual({ roles: [], permissions: [] });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/admin/roles", { cache: "no-store", signal: controller.signal });
  });

  it("surfaces an authorization failure instead of treating a denied catalog as empty", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }));

    await expect(fetchRoleCatalog(undefined, fetcher)).rejects.toThrow("forbidden");
  });
});
