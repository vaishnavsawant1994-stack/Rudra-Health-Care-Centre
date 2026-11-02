import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import pg from "pg";
import { loadProjectEnvironment } from "./load-project-env.mjs";
import { rotatePatientDataKey } from "./rotate-patient-data-key.mjs";

loadProjectEnvironment();
const databaseUrl = process.env.DATABASE_MIGRATION_URL;
if (!databaseUrl) throw new Error("Local migration database is unavailable.");
const target = new URL(databaseUrl);
if (target.pathname !== "/rudra_health_dev" || !["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) throw new Error("Patient key rotation is restricted to the configured loopback development database.");
const activeId = process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-patient-key-rotation-preflight" });
let staleCount;
try {
  const result = await pool.query("SELECT count(*)::integer AS count FROM patient_contact_secrets WHERE encryption_key_id <> $1", [activeId]);
  staleCount = result.rows[0]?.count ?? 0;
} finally { await pool.end(); }

const confirmation = "ROTATE RUDRA LOCAL PATIENT DATA KEY";
const terminal = readline.createInterface({ input: stdin, output: stdout });
try {
  stdout.write(`This will re-encrypt ${staleCount} local patient record(s) to the configured active application-field key. Back up the database and complete keyring first; retain every historical key until backups and all dependent data are verified. Blind indexes and business fields are not changed.\n`);
  const answer = await terminal.question(`Type ${confirmation} to continue: `);
  if (answer !== confirmation) throw new Error("Patient key rotation was not confirmed.");
} finally { terminal.close(); }

try {
  const result = await rotatePatientDataKey({ databaseUrl, schema: "public" });
  console.log(`Patient encrypted records verified: ${result.verified}; re-encrypted to active key: ${result.rotated}. Historical keys were retained.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Patient key rotation stopped safely.");
  process.exitCode = 1;
}
