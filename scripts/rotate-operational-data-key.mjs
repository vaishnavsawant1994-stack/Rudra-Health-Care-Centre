import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import pg from "pg";
import { loadProjectEnvironment } from "./load-project-env.mjs";
import { rotateOperationalDataKey } from "./encrypt-operational-data.mjs";

loadProjectEnvironment();
const databaseUrl = process.env.DATABASE_MIGRATION_URL;
if (!databaseUrl) throw new Error("Local migration database is unavailable.");
const target = new URL(databaseUrl);
if (target.pathname !== "/rudra_health_dev" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) {
  throw new Error("Operational key rotation is restricted to the configured loopback development database.");
}
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-operational-key-rotation-preflight" });
try {
  const migration = await pool.query("SELECT 1 FROM app_schema_migrations WHERE migration_name = $1", ["0089_operational_rotation_table_scope.sql"]);
  if (migration.rowCount !== 1) throw new Error("Apply and verify the operational key-rotation migrations before running this command.");
} finally {
  await pool.end();
}

const confirmation = "ROTATE RUDRA LOCAL OPERATIONAL DATA KEY";
const terminal = readline.createInterface({ input: stdin, output: stdout });
try {
  stdout.write("This re-encrypts existing operational ciphertext in the local Rudra development database. It does not change business fields. Keep all historical keys in the configured keyring and back up keys plus database first.\n");
  const answer = await terminal.question(`Type ${confirmation} to continue: `);
  if (answer !== confirmation) throw new Error("Operational key rotation was not confirmed.");
} finally {
  terminal.close();
}

try {
  const result = await rotateOperationalDataKey({ databaseUrl, schema: "public" });
  console.log(`Operational encrypted payloads verified: ${result.verified}; re-encrypted to active key: ${result.rotated}. Historical keys were retained.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Operational key rotation stopped safely.");
  process.exitCode = 1;
}
