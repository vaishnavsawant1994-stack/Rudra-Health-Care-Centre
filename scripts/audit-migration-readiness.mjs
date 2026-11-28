import pg from "pg";
import { loadProjectEnvironment } from "./load-project-env.mjs";
import { getMigrationFiles } from "./migrate.mjs";

loadProjectEnvironment();
const { Pool } = pg;
const migrations = await getMigrationFiles();

async function inspectTarget(label, connectionString) {
  if (!connectionString || !/^postgres(?:ql)?:\/\//i.test(connectionString)) return { target: label, configured: false };
  const url = new URL(connectionString);
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-read-only-migration-readiness" });
  try {
    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const identity = await client.query("SELECT current_database() AS database, current_user AS connected_role, inet_server_addr()::text AS server_address, version() AS server_version");
      const ledger = await client.query("SELECT migration_name, checksum FROM app_schema_migrations ORDER BY migration_name");
      const roles = await client.query("SELECT rolname, rolsuper, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = current_user OR rolname = 'rudra_dev_app' ORDER BY rolname");
      const privileges = await client.query(`SELECT
        to_regclass('public.finance_payments') IS NOT NULL AS finance_payments_exists,
        to_regclass('public.lead_quotes') IS NOT NULL AS lead_quotes_exists,
        to_regclass('public.metropolis_reference_mappings') IS NOT NULL AS metropolis_tables_exist,
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN has_table_privilege('rudra_dev_app','finance_payments','SELECT') ELSE false END AS app_finance_read,
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN has_table_privilege('rudra_dev_app','finance_payments','INSERT') ELSE false END AS app_finance_insert,
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN has_table_privilege('rudra_dev_app','finance_payments','UPDATE') ELSE false END AS app_finance_update,
        CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN has_table_privilege('rudra_dev_app','finance_payments','DELETE') ELSE false END AS app_finance_delete`);
      const preflight = await client.query(`SELECT
        CASE WHEN to_regclass('collection_job_events') IS NULL THEN NULL ELSE (
          SELECT count(*)::int FROM collection_job_events WHERE event_type NOT IN
          ('CREATED','ASSIGNED','REASSIGNED','VISIT_STARTED','TRAVEL_STARTED','ARRIVED','ATTEMPT_FAILED','COLLECTION_RECORDED','CANCELLED','RESCHEDULED','VISIT_DELAYED','ASSIGNMENT_DECLINED','ASSIGNMENT_ACCEPTED')
        ) END AS unsupported_collection_event_count,
        CASE WHEN to_regclass('website_content_pages') IS NULL THEN NULL ELSE (
          SELECT count(*)::int FROM website_content_pages WHERE slug NOT IN
          ('home','about','home-collection','faq','corporate','doctors','partners','centres','service-areas','tests','packages','booking','contact')
        ) END AS disallowed_website_slug_count,
        to_regprocedure('sample_events_append_only()') IS NOT NULL AS metropolis_trigger_dependency_present,
        to_regclass('lead_quotes') IS NOT NULL AS quote_migration_already_present,
        to_regclass('metropolis_reference_mappings') IS NOT NULL AS metropolis_migration_already_present`);
      const archive = await client.query("SELECT archived_count, failed_count, last_archived_wal, last_archived_time, last_failed_wal, last_failed_time FROM pg_stat_archiver").catch(() => null);
      await client.query("ROLLBACK");
      const applied = new Map(ledger.rows.map((row) => [row.migration_name, row.checksum.trim()]));
      const missing = migrations.filter((migration) => !applied.has(migration.name)).map((migration) => migration.name);
      const mismatched = migrations.filter((migration) => applied.has(migration.name) && applied.get(migration.name) !== migration.checksum).map((migration) => migration.name);
      const unknown = [...applied.keys()].filter((name) => !migrations.some((migration) => migration.name === name));
      const db = identity.rows[0];
      return {
        target: label,
        configured: true,
        hostIsLoopback: ["localhost", "127.0.0.1", "::1"].includes(url.hostname),
        database: db.database,
        connectedRole: db.connected_role,
        serverAddress: db.server_address,
        serverVersion: db.server_version.split(" ").slice(0, 2).join(" "),
        migrationCount: ledger.rowCount,
        latestApplied: ledger.rows.at(-1)?.migration_name ?? null,
        missing,
        mismatched,
        unknown,
        roles: roles.rows,
        privileges: privileges.rows[0],
        migrationPreflight: preflight.rows[0],
        archiveStats: archive?.rows[0] ?? "not visible to connected role",
        transactionReadOnly: true,
      };
    } finally {
      await client.release();
    }
  } finally {
    await pool.end();
  }
}

for (const [label, connectionString] of [["application", process.env.DATABASE_URL], ["migration", process.env.DATABASE_MIGRATION_URL]]) {
  try {
    console.log(JSON.stringify(await inspectTarget(label, connectionString)));
  } catch (error) {
    console.log(JSON.stringify({ target: label, configured: Boolean(connectionString), inspectionError: error instanceof Error ? error.message : "metadata inspection failed", transactionReadOnly: true }));
  }
}
