import { describe, expect, it } from "vitest";
import {
  buildLocalConnectionUrl,
  inspectConnectionTarget,
  isLocalListenAddress,
  mergeLocalEnvironment,
  readConfiguredListenAddress,
} from "./configure-local-db-env.mjs";

describe("local database environment setup", () => {
  it("encodes role passwords in local connection URLs", () => {
    const password = "S:p@ce/#?&%雪";
    const connectionUrl = buildLocalConnectionUrl({
      role: "rudra_dev_app",
      database: "rudra_health_dev",
      password,
    });
    const parsed = new URL(connectionUrl);

    expect(decodeURIComponent(parsed.password)).toBe(password);
    expect(parsed.hostname).toBe("127.0.0.1");
    expect(decodeURIComponent(parsed.username)).toBe("rudra_dev_app");
    expect(parsed.pathname).toBe("/rudra_health_dev");
  });

  it("accepts only the expected local role/database connection target", () => {
    const expected = { role: "rudra_dev_app", database: "rudra_health_dev" };
    const localUrl = buildLocalConnectionUrl({ ...expected, password: "synthetic-only" });
    const remoteUrl = localUrl.replace("127.0.0.1", "example.invalid");

    expect(inspectConnectionTarget(localUrl, expected)).toEqual({
      valid: true,
      local: true,
      expectedRole: true,
      expectedDatabase: true,
    });
    expect(inspectConnectionTarget(remoteUrl, expected).local).toBe(false);
  });

  it("merges database settings without discarding unrelated local secrets", () => {
    const original = "OIDC_CLIENT_SECRET=synthetic-secret\n# keep this comment\nDATABASE_URL=old-url\n";
    const merged = mergeLocalEnvironment(original, {
      DATABASE_URL: "new-url",
      DATABASE_MIGRATION_URL: "migration-url",
    });

    expect(merged).toContain("OIDC_CLIENT_SECRET=synthetic-secret");
    expect(merged).toContain("# keep this comment");
    expect(merged.match(/^DATABASE_URL=/gm)).toHaveLength(1);
    expect(merged).toContain("DATABASE_URL=new-url");
    expect(merged).toContain("DATABASE_MIGRATION_URL=migration-url");
  });

  it("recognizes localhost-only PostgreSQL bindings", () => {
    expect(isLocalListenAddress("localhost")).toBe(true);
    expect(isLocalListenAddress("127.0.0.1, ::1")).toBe(true);
    expect(isLocalListenAddress("*")).toBe(false);
    expect(isLocalListenAddress("0.0.0.0")).toBe(false);
  });

  it("uses the auto configuration override when checking PostgreSQL listener scope", () => {
    expect(readConfiguredListenAddress("listen_addresses = '*'", "listen_addresses = 'localhost'")).toBe("localhost");
    expect(readConfiguredListenAddress("listen_addresses = 'localhost'", "")).toBe("localhost");
    expect(readConfiguredListenAddress("# listen_addresses = 'localhost'", "")).toBe("*");
  });
});
