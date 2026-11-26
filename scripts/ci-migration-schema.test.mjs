import { describe, expect, it } from "vitest";
import { createCiMigrationSchema } from "./ci-migration-schema.mjs";

describe("CI migration rehearsal schema", () => {
  it("uses the existing restricted P2-09A disposable schema namespace", () => {
    const schema = createCiMigrationSchema({ pid: 1234, suffix: "0123456789" });
    expect(schema).toBe("p2_09a_ci_upgrade_1234_0123456789");
    expect(schema).toMatch(/^p2_09a_[a-z0-9_]{1,48}$/);
  });

  it("rejects values that could escape the approved schema identifier pattern", () => {
    expect(() => createCiMigrationSchema({ pid: "12;drop schema public", suffix: "0123456789" })).toThrow("Invalid disposable CI migration schema name.");
    expect(() => createCiMigrationSchema({ pid: 1234, suffix: "bad-suffix" })).toThrow("Invalid disposable CI migration schema name.");
  });
});
