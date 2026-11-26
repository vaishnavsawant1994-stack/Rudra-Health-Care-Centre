import { randomBytes } from "node:crypto";
import pg from "pg";
import { getMigrationFiles, runMigrations } from "./migrate.mjs";

const databaseUrl = process.env.DATABASE_MIGRATION_URL;
if (process.env.GITHUB_ACTIONS !== "true" || !databaseUrl) throw new Error("This migration rehearsal is restricted to the disposable GitHub Actions PostgreSQL service.");
const target = new URL(databaseUrl);
if (!/^\/rudra_health_test$/.test(target.pathname) || !["127.0.0.1", "localhost", "::1"].includes(target.hostname)) {
  throw new Error("Refusing migration rehearsal outside the loopback rudra_health_test database.");
}

const schema = `ci_upgrade_${process.pid}_${randomBytes(5).toString("hex")}`;
if (!/^ci_upgrade_[0-9]+_[a-f0-9]{10}$/.test(schema)) throw new Error("Invalid disposable migration schema name.");
const client = new pg.Client({ connectionString: databaseUrl, application_name: "rudra-ci-migration-upgrade-qualification" });
let created = false;
try {
  await client.connect();
  await client.query(`CREATE SCHEMA "${schema}"`);
  created = true;

  const sourceMigrations = await getMigrationFiles();
  const baselineName = "0093_sample_receiving_submission.sql";
  if (!sourceMigrations.some((migration) => migration.name === baselineName)) throw new Error("Expected migration 0093 baseline is missing.");
  const baseline = await runMigrations(databaseUrl, baselineName, schema);
  await client.query(`SET search_path TO "${schema}", public`);
  const baselineRows = await client.query("SELECT migration_name FROM app_schema_migrations ORDER BY migration_name");
  if (baselineRows.rowCount !== 93 || baselineRows.rows.at(-1)?.migration_name !== baselineName) throw new Error("Disposable schema did not stop at migration 0093.");

  const upgrade = await runMigrations(databaseUrl, null, schema);
  const upgradedRows = await client.query("SELECT migration_name, checksum FROM app_schema_migrations ORDER BY migration_name");
  if (upgradedRows.rowCount !== 102 || upgradedRows.rows.at(-1)?.migration_name !== "0102_organization_audit_read_permission.sql") throw new Error("Disposable schema did not reach migration 0102.");
  const checksums = new Map(upgradedRows.rows.map((row) => [row.migration_name, row.checksum.trim()]));
  if (sourceMigrations.some((migration) => checksums.get(migration.name) !== migration.checksum)) throw new Error("Migration upgrade checksum verification failed.");

  const replay = await runMigrations(databaseUrl, null, schema);
  if (replay.applied !== 0 || replay.total !== 102 || upgrade.applied !== 9 || baseline.applied !== 93) throw new Error("Migration upgrade or idempotent replay counts did not match expectations.");
  console.log("Disposable CI migration rehearsal passed: fresh schema through 0093, upgrade through 0102, all checksums matched, and replay applied zero migrations.");
} finally {
  try {
    if (created) await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => { throw new Error("Could not remove the CI-owned disposable migration schema."); });
  } finally {
    await client.end();
  }
}
