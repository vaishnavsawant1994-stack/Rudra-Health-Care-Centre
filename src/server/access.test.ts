import { afterEach, describe, expect, it, vi } from "vitest";
import { getAccess, getApiAccess } from "./access";

afterEach(() => vi.unstubAllEnvs());

describe("fail-closed protected access", () => {
  it("renders setup-required access without opening a protected data path", async () => {
    for (const key of ["DATABASE_URL", "BETTER_AUTH_SECRET", "BETTER_AUTH_URL"]) vi.stubEnv(key, "");
    expect((await getAccess("organization.read")).kind).toBe("setup");
    const result = await getApiAccess("organization.read");
    expect(result.staff).toBeNull();
    expect(result.response?.status).toBe(503);
    const payload = await result.response?.json();
    expect(payload.error).toBe("setup_required");
    expect(payload.organization).toBeUndefined();
  });
  it("fails closed when complete configuration exists but no server request session is available", async () => {
    vi.stubEnv("DATABASE_URL", "postgresql://rudra:local-only@127.0.0.1:5432/rudra_health_os");
    vi.stubEnv("BETTER_AUTH_SECRET", "A".repeat(48));
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    const result = await getApiAccess("organization.read");
    expect(result.staff).toBeNull();
    expect(result.response?.status).toBe(503);
    const payload = result.response ? await result.response.json() : null;
    expect(payload?.error).toBe("service_unavailable");
  });
});
