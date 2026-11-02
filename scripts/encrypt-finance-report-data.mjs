import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { loadProjectEnvironment } from "./load-project-env.mjs";

loadProjectEnvironment();
const { Pool } = pg;
const TABLES = [
  ["finance_payments", "finance-payment", ["reference"]],
  ["finance_adjustments", "finance-adjustment", ["reason"]],
  ["finance_refunds", "finance-refund", ["reason", "execution_reference"]],
  ["finance_events", "finance-event", ["reason", "evidence_reference"]],
  ["finance_reconciliations", "finance-reconciliation", ["reason"]],
  ["diagnostic_reports", "report-private", ["external_reference", "hold_reason"]],
  ["report_events", "report-event", ["reason", "evidence_reference"]],
  ["report_deliveries", "report-delivery", ["recipient_label", "recipient_verification_reference", "evidence_reference"]],
  ["report_followups", "report-followup", ["outcome", "outcome_note"]],
  ["report_followup_events", "report-followup-event", ["note"]],
];
const camel = (value) => value.replace(/_([a-z])/g, (_match, char) => char.toUpperCase());
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
function config(databaseUrl, schema) {
  const url = new URL(databaseUrl ?? "");
  const dev = databaseUrl === process.env.DATABASE_MIGRATION_URL && decodeURIComponent(url.pathname.slice(1)) === "rudra_health_dev";
  const test = databaseUrl === process.env.DATABASE_TEST_URL && /test/i.test(decodeURIComponent(url.pathname.slice(1))) && (schema === "public" || /^p2_09[a-z0-9]*_[a-z0-9_]{1,48}$/.test(schema));
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || (!dev && !test)) throw new Error("Finance/report backfill target must be the configured local development or isolated test database.");
  let keys;
  try { keys = JSON.parse(process.env.RUDRA_FIELD_ENCRYPTION_KEYS ?? ""); } catch { throw new Error("Finance/report encryption keys are unavailable."); }
  const active = process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
  if (!active || typeof keys?.[active] !== "string" || Buffer.from(keys[active], "base64").length !== 32) throw new Error("Finance/report active encryption key is unavailable.");
  return { url: url.toString(), schema, keys, active, activeKey: Buffer.from(keys[active], "base64") };
}
function aad(row, type, keyId) { return Buffer.from(`rudra:operational-data:v1:${row.organization_id}:${row.centre_id}:${type}:${row.id}:${keyId}`); }
function encrypt(value, row, type, cfg) {
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", cfg.activeKey, nonce);
  cipher.setAAD(aad(row, type, cfg.active));
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `v1.${cfg.active}.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}
export function decryptFinanceReportEnvelope(envelope, row, type, cfg) {
  if (!envelope) throw new Error("Finance/report ciphertext is missing.");
  const [version, keyId, nonceText, tagText, data, ...extra] = envelope.split(".");
  if (version !== "v1" || !keyId || !nonceText || !tagText || data === undefined || extra.length) throw new Error("Finance/report ciphertext envelope is invalid.");
  const key = Buffer.from(cfg.keys[keyId] ?? "", "base64");
  if (key.length !== 32) throw new Error("A required historical finance/report encryption key is unavailable.");
  try {
    const nonce = Buffer.from(nonceText, "base64url"), tag = Buffer.from(tagText, "base64url");
    if (nonce.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, nonce); decipher.setAAD(aad(row, type, keyId)); decipher.setAuthTag(tag);
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8"));
  } catch { throw new Error("Finance/report ciphertext integrity verification failed."); }
}

async function tableColumns(client, schema, table) {
  const result = await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2", [schema, table]);
  return new Set(result.rows.map((row) => row.column_name));
}

export async function backfillFinanceReportData({ databaseUrl = process.env.DATABASE_MIGRATION_URL, schema = "public", logger = console, interruptAfterFirstTable = false } = {}) {
  const cfg = config(databaseUrl, schema);
  const pool = new Pool({ connectionString: cfg.url, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-finance-report-encryption", options: `-c search_path=${schema},public` });
  const client = await pool.connect(); let processed = 0;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('rudra:finance-report-sensitive-backfill:v1',0))");
    for (const [table, type, privateFields] of TABLES) {
      const cols = await tableColumns(client, schema, table);
      if (!cols.has("private_data_ciphertext")) continue;
      const legacyFields = privateFields.filter((field) => cols.has(field));
      const projection = legacyFields.length ? `,${legacyFields.map((field) => `"${field}"`).join(",")}` : "";
      for (;;) {
        await client.query("BEGIN"); let finished = false;
        try {
          const batch = await client.query(`SELECT id,organization_id,centre_id,private_data_ciphertext${projection} FROM "${table}" WHERE private_data_ciphertext IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`);
          if (!batch.rowCount) { await client.query("COMMIT"); finished = true; }
          else {
            for (const row of batch.rows) {
              const payload = Object.fromEntries(privateFields.map((field) => [camel(field), cols.has(field) ? row[field] ?? null : null]));
              const envelope = encrypt(payload, row, type, cfg);
              await client.query(`UPDATE "${table}" SET private_data_ciphertext=$1 WHERE id=$2 AND private_data_ciphertext IS NULL`, [envelope, row.id]);
              processed++;
            }
            await client.query("COMMIT");
          }
        } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
        if (finished) break;
      }
      const result = await client.query(`SELECT id,organization_id,centre_id,private_data_ciphertext${projection} FROM "${table}" ORDER BY id`);
      for (const row of result.rows) {
        const payload = decryptFinanceReportEnvelope(row.private_data_ciphertext, row, type, cfg);
        for (const field of legacyFields) if (canonical(payload[camel(field)]) !== canonical(row[field])) throw new Error(`Finance/report backfill parity check failed for ${table}.`);
      }
      logger.log(`${table}: encrypted payload verified for ${result.rowCount} row(s).`);
      if (interruptAfterFirstTable) { interruptAfterFirstTable = false; throw new Error("synthetic_backfill_interruption"); }
    }
    logger.log(`Finance/report encryption backfill verified; ${processed} row(s) encrypted during this run.`);
    return { processed };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended('rudra:finance-report-sensitive-backfill:v1',0))").catch(() => {});
    client.release(); await pool.end();
  }
}

/**
 * Restartable, row-locked re-encryption of finance/report envelopes to the
 * configured active key. This does not remove historical keys; callers must
 * retain them until every application and backup has been verified.
 */
export async function rotateFinanceReportDataKey({ databaseUrl = process.env.DATABASE_TEST_URL, schema = "public", logger = console, interruptAfterFirstBatch = false } = {}) {
  const cfg = config(databaseUrl, schema);
  const pool = new Pool({ connectionString: cfg.url, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-finance-report-key-rotation", options: `-c search_path=${schema},public` });
  const client = await pool.connect(); let verified = 0; let rotated = 0; let interrupted = false;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('rudra:finance-report-key-rotation:v1',0))");
    for (const [table, type] of TABLES) {
      let cursor = null;
      for (;;) {
        await client.query("BEGIN");
        try {
          const batch = await client.query(
            `SELECT id,organization_id,centre_id,private_data_ciphertext FROM "${table}" WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT 100 FOR UPDATE`,
            [cursor],
          );
          if (!batch.rowCount) { await client.query("COMMIT"); break; }
          for (const row of batch.rows) {
            const plaintext = decryptFinanceReportEnvelope(row.private_data_ciphertext, row, type, cfg);
            const currentKeyId = row.private_data_ciphertext.split(".")[1];
            if (currentKeyId !== cfg.active) {
              await client.query("SELECT set_config('rudra.finance_report_key_rotation','on',true)");
              const replacement = encrypt(plaintext, row, type, cfg);
              const updated = await client.query(`UPDATE "${table}" SET private_data_ciphertext=$1 WHERE id=$2 AND private_data_ciphertext=$3`, [replacement, row.id, row.private_data_ciphertext]);
              if (updated.rowCount !== 1) throw new Error("Finance/report key rotation encountered a concurrent record change.");
              rotated += 1;
            }
            verified += 1;
            cursor = row.id;
          }
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK").catch(() => {}); throw error; }
        if (interruptAfterFirstBatch) { interruptAfterFirstBatch = false; interrupted = true; throw new Error("synthetic_key_rotation_interruption"); }
      }
      logger.log(`${table}: encrypted envelope verification complete.`);
      const stale = await client.query(`SELECT count(*)::integer AS count FROM "${table}" WHERE split_part(private_data_ciphertext,'.',2) <> $1`, [cfg.active]);
      if (stale.rows[0]?.count !== 0) throw new Error("Finance/report key rotation found records still encrypted with a historical key.");
    }
    return { verified, rotated, interrupted };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended('rudra:finance-report-key-rotation:v1',0))").catch(() => {});
    client.release(); await pool.end();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await backfillFinanceReportData(); }
  catch (error) { console.error(error instanceof Error ? error.message : "Finance/report backfill stopped safely."); process.exitCode = 1; }
}
