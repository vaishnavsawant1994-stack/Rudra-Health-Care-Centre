import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import pg from "pg";
import { loadProjectEnvironment } from "./load-project-env.mjs";
import { rotateFamilyLeadDataKey } from "./rotate-family-lead-data-key.mjs";

loadProjectEnvironment();
const databaseUrl = process.env.DATABASE_MIGRATION_URL;
if (!databaseUrl) throw new Error("Local migration database is unavailable.");
const target = new URL(databaseUrl);
if (target.pathname !== "/rudra_health_dev" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) throw new Error("Family/lead key rotation is restricted to the configured loopback development database.");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-family-lead-key-rotation-preflight" });
try {
  const guard = await pool.query("SELECT 1 FROM app_schema_migrations WHERE migration_name = $1", ["0090_lead_history_key_rotation_guard.sql"]);
  if (guard.rowCount !== 1) throw new Error("Apply and verify migration 0090 before family/lead history key rotation.");
} finally { await pool.end(); }

const confirmation = "ROTATE RUDRA LOCAL FAMILY AND CRM DATA KEY";
const terminal = readline.createInterface({ input: stdin, output: stdout });
try {
  stdout.write("This re-encrypts existing family and CRM private ciphertext in the local development database. Back up the database and complete keyring first; retain all historical keys. Blind indexes and business/event fields are not changed.\n");
  const answer = await terminal.question(`Type ${confirmation} to continue: `);
  if (answer !== confirmation) throw new Error("Family/lead key rotation was not confirmed.");
} finally { terminal.close(); }

try {
  const result = await rotateFamilyLeadDataKey({ databaseUrl, schema: "public" });
  console.log(`Family/lead ciphertext verified: ${result.verified}; re-encrypted to active key: ${result.rotated}. Historical keys were retained.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Family/lead key rotation stopped safely.");
  process.exitCode = 1;
}
