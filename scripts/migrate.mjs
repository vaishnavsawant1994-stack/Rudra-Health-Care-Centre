import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";
import { loadProjectEnvironment } from "./load-project-env.mjs";

loadProjectEnvironment();

const { Pool } = pg;
const migrationsDirectory = fileURLToPath(new URL("../drizzle/migrations/", import.meta.url));
const lockKey = 741220251;

export function migrationChecksum(sql) {
  return createHash("sha256").update(sql, "utf8").digest("hex");
}

export async function getMigrationFiles(directory = migrationsDirectory) {
  const names = (await readdir(directory)).filter((name) => /^\d{4}_[a-z0-9_]+\.sql$/.test(name)).sort();
  const files = [];
  for (const name of names) {
    const sql = await readFile(path.join(directory, name), "utf8");
    files.push({ name, sql, checksum: migrationChecksum(sql) });
  }
  return files;
}

export async function runMigrations(databaseUrl, throughMigration = null, schema = "public") {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error("Invalid migration schema name.");
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-health-os-migrations" });
  const client = await pool.connect();
  let applied = 0;
  try {
    await client.query(`SET search_path TO "${schema}", public`);
    await client.query("SELECT pg_advisory_lock($1, 1)", [lockKey]);
    await client.query(`CREATE TABLE IF NOT EXISTS app_schema_migrations (
      migration_name text PRIMARY KEY,
      checksum char(64) NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const files = await getMigrationFiles();
    for (const file of files) {
      const existing = await client.query("SELECT checksum FROM app_schema_migrations WHERE migration_name = $1", [file.name]);
      if (existing.rowCount) {
        if (existing.rows[0].checksum !== file.checksum) throw new Error(`Applied migration checksum mismatch: ${file.name}`);
        if (file.name === "0033_lead_sensitive_encryption_prepare.sql") {
          const { backfillLeadData } = await import("./encrypt-lead-data.mjs");
          await backfillLeadData({ databaseUrl, schema, logger: { log() {} } });
        }
        if (file.name === "0035_operational_sensitive_encryption_prepare.sql") {
          const { backfillOperationalData } = await import("./encrypt-operational-data.mjs");
          await backfillOperationalData({ databaseUrl, schema, logger: { log() {} } });
        }
        if (file.name === "0039_finance_report_private_encryption_prepare.sql") {
          const { backfillFinanceReportData } = await import("./encrypt-finance-report-data.mjs");
          await backfillFinanceReportData({ databaseUrl, schema, logger: { log() {} } });
        }
        if(file.name===throughMigration)break;
        continue;
      }
      await client.query("BEGIN");
      try {
        await client.query(file.sql);
        await client.query("INSERT INTO app_schema_migrations (migration_name, checksum) VALUES ($1, $2)", [file.name, file.checksum]);
        await client.query("COMMIT");
        applied += 1;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
      }
      if(file.name===throughMigration)break;
      if (file.name === "0033_lead_sensitive_encryption_prepare.sql") {
        const { backfillLeadData } = await import("./encrypt-lead-data.mjs");
        await backfillLeadData({ databaseUrl, schema, logger: { log() {} } });
      }
      if (file.name === "0035_operational_sensitive_encryption_prepare.sql") {
        const { backfillOperationalData } = await import("./encrypt-operational-data.mjs");
        await backfillOperationalData({ databaseUrl, schema, logger: { log() {} } });
      }
      if (file.name === "0039_finance_report_private_encryption_prepare.sql") {
        const { backfillFinanceReportData } = await import("./encrypt-finance-report-data.mjs");
        await backfillFinanceReportData({ databaseUrl, schema, logger: { log() {} } });
      }
    }
    return { applied, total: files.length };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1, 1)", [lockKey]).catch(() => undefined);
    client.release();
    await pool.end();
  }
}

export async function verifyMigrationHistory(databaseUrl) {
  const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-health-os-migration-check" });
  try {
    const files = await getMigrationFiles();
    const result = await pool.query("SELECT migration_name, checksum FROM app_schema_migrations ORDER BY migration_name");
    const applied = new Map(result.rows.map((row) => [row.migration_name, row.checksum.trim()]));
    for (const file of files) {
      const checksum = applied.get(file.name);
      if (!checksum) throw new Error(`Migration has not been applied: ${file.name}`);
      if (checksum !== file.checksum) throw new Error(`Applied migration checksum mismatch: ${file.name}`);
    }
    for (const name of applied.keys()) if (!files.some((file) => file.name === name)) throw new Error(`Database contains an unknown migration: ${name}`);
    return { applied: applied.size, expected: files.length };
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const databaseUrl = process.env.DATABASE_MIGRATION_URL;
  if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
    console.error("DATABASE_MIGRATION_URL must be a PostgreSQL connection URL. No database changes were made.");
    process.exitCode = 1;
  } else {
    try {
      const result = await runMigrations(databaseUrl);
      console.log(`Database migrations verified. Applied ${result.applied} new migration(s); ${result.total} total.`);
    } catch {
      console.error("Migration failed. Check PostgreSQL availability, credentials, and migration history; details were withheld to avoid printing connection secrets.");
      process.exitCode = 1;
    }
  }
}
