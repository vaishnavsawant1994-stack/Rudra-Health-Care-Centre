import { describe, expect, it } from "vitest";
import { getSetupStatus, parsePhaseOneEnvironment } from "./phase-one-config";

describe("Phase 01 environment gate", () => {
  it("fails closed and reports missing variable names only", () => {
    const status = getSetupStatus({});
    expect(status.ready).toBe(false);
    expect(status.missing).toContain("DATABASE_URL");
    expect(JSON.stringify(status)).not.toContain("secret");
  });
  it("rejects short secrets and non-PostgreSQL URLs", () => {
    const result = parsePhaseOneEnvironment({ DATABASE_URL: "https://example.org", BETTER_AUTH_SECRET: "short" });
    expect(result.ready).toBe(false);
    expect(result.invalid).toContain("DATABASE_URL");
    expect(result.invalid).toContain("BETTER_AUTH_SECRET");
  });
  it("does not require an external identity provider for local authentication", () => {
    const result = parsePhaseOneEnvironment({ DATABASE_URL: "postgresql://rudra_dev_app:local-only@127.0.0.1:5432/rudra_health_dev", BETTER_AUTH_SECRET: "A".repeat(48), BETTER_AUTH_URL: "http://localhost:3000" });
    expect(result.ready).toBe(true);
    expect(getSetupStatus({ DATABASE_URL: "postgresql://rudra_dev_app:local-only@127.0.0.1:5432/rudra_health_dev", BETTER_AUTH_SECRET: "A".repeat(48), BETTER_AUTH_URL: "http://localhost:3000" }).authenticationConfigured).toBe(true);
  });
});
