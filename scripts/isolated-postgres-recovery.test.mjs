import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertDisposableTestUrl,
  backupSchema,
  restoreSchema,
  restrictedToolEnvironment,
} from "./isolated-postgres-recovery.mjs";

const disposableUrl = "postgresql://synthetic_user:test-only-password@127.0.0.1:5432/rudra_health_test";
const sourceSchema = "p2_09a_source_1234";
const destinationSchema = "p2_09a_restore_5678";
let temporaryDirectory;

afterEach(async () => {
  if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
  temporaryDirectory = undefined;
});

describe("isolated PostgreSQL recovery safeguards", () => {
  it("accepts only the dedicated synthetic test database", () => {
    expect(assertDisposableTestUrl(disposableUrl).pathname).toBe("/rudra_health_test");
    expect(() => assertDisposableTestUrl("postgresql://user:secret@localhost/rudra_health_dev")).toThrow("recovery_requires_dedicated_test_database");
    expect(() => assertDisposableTestUrl("not-a-url")).toThrow("recovery_test_database_url_invalid");
  });

  it("passes connection material through a restricted environment instead of command arguments", () => {
    const environment = restrictedToolEnvironment(disposableUrl, {
      PATH: "test-path",
      HOME: "test-home",
      DATABASE_URL: "must-not-be-forwarded",
      API_SECRET: "must-not-be-forwarded",
    });
    expect(environment).toMatchObject({ PATH: "test-path", HOME: "test-home", PGUSER: "synthetic_user", PGPASSWORD: "test-only-password", PGDATABASE: "rudra_health_test" });
    expect(environment).not.toHaveProperty("DATABASE_URL");
    expect(environment).not.toHaveProperty("API_SECRET");
  });

  it("rejects non-disposable schema names before invoking dump tools", async () => {
    await expect(backupSchema({ connectionString: disposableUrl, schema: "public", backupPath: "unused", tools: { pgDump: "unused" } }))
      .rejects.toThrow("recovery_schema_not_disposable");
  });

  it("rejects a restore when source/target schema or dump evidence is invalid", async () => {
    await expect(restoreSchema({ connectionString: disposableUrl, sourceSchema, destinationSchema: sourceSchema, backupSql: sourceSchema, restorePath: "unused", tools: { psql: "unused" } }))
      .rejects.toThrow("recovery_schema_names_must_differ");
    await expect(restoreSchema({ connectionString: disposableUrl, sourceSchema, destinationSchema, backupSql: "-- no source schema", restorePath: "unused", tools: { psql: "unused" } }))
      .rejects.toThrow("recovery_backup_schema_missing");
  });

  it("remaps only into disposable schemas and creates a non-overwriting restore script", async () => {
    temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "rudra-recovery-unit-"));
    const restorePath = path.join(temporaryDirectory, "restore.sql");
    const backupSql = `CREATE SCHEMA ${sourceSchema};\nSET search_path = ${sourceSchema};\n`;
    const result = await restoreSchema({
      connectionString: disposableUrl,
      sourceSchema,
      destinationSchema,
      backupSql,
      restorePath,
      tools: { psql: "not-invoked" },
    }).catch((error) => error);
    // The fake tool deliberately cannot run; the SQL file must nevertheless be created
    // only after validation and contain the destination schema substitution.
    expect(result.message).toContain("recovery_tool_failed");
    expect(await readFile(restorePath, "utf8")).toBe(backupSql.split(sourceSchema).join(destinationSchema));
  });
});
