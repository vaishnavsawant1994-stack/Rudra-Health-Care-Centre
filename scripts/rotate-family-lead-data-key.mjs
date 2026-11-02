import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { loadProjectEnvironment } from "./load-project-env.mjs";

loadProjectEnvironment();
const { Pool } = pg;

const tables = [
  { table: "families", idColumn: "id", column: "display_name_ciphertext", contextType: "family", field: "display-name", encoding: "text" },
  { table: "family_members", idColumn: "id", column: "evidence_ciphertext", contextType: "family", field: "member-evidence", encoding: "text" },
  { table: "family_access_grants", idColumn: "id", column: "purpose_ciphertext", contextType: "family", field: "grant-purpose", encoding: "text" },
  { table: "family_access_grants", idColumn: "id", column: "evidence_ciphertext", contextType: "family", field: "grant-evidence", encoding: "text" },
  { table: "family_contact_arrangements", idColumn: "id", column: "evidence_ciphertext", contextType: "family", field: "contact-evidence", encoding: "text" },
  { table: "lead_private_data", idColumn: "lead_id", column: "payload_ciphertext", contextType: "lead", field: "private-data", encoding: "json" },
  { table: "lead_activities", idColumn: "id", column: "private_payload_ciphertext", contextType: "lead", field: "activity", encoding: "json" },
  { table: "lead_followups", idColumn: "id", column: "outcome_note_ciphertext", contextType: "lead", field: "followup-note", encoding: "json" },
  { table: "lead_conversions", idColumn: "id", column: "identity_evidence_ciphertext", contextType: "lead", field: "conversion-evidence", encoding: "json" },
];

function config(databaseUrl, schema) {
  const url = new URL(databaseUrl ?? "");
  const development = databaseUrl === process.env.DATABASE_MIGRATION_URL && url.pathname === "/rudra_health_dev";
  const test = databaseUrl === process.env.DATABASE_TEST_URL && url.pathname === "/rudra_health_test" && /^p2_09a_[a-z0-9_]{1,48}$/.test(schema);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || (!development && !test)) throw new Error("Family/lead key rotation is restricted to local development or a disposable P2-09A test schema.");
  let keys;
  try { keys = JSON.parse(process.env.RUDRA_FIELD_ENCRYPTION_KEYS ?? ""); } catch { throw new Error("Application-field encryption keyring unavailable."); }
  if (!keys || typeof keys !== "object" || Array.isArray(keys)) throw new Error("Application-field encryption keyring invalid.");
  for (const [id, encoded] of Object.entries(keys)) if (!/^[A-Za-z0-9_-]{1,48}$/.test(id) || typeof encoded !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(encoded) || Buffer.from(encoded, "base64").length !== 32) throw new Error("Application-field encryption keyring invalid.");
  const activeId = process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
  if (!activeId || !keys[activeId]) throw new Error("Active application-field encryption key unavailable.");
  return { url: url.toString(), schema, keys, activeId };
}

function aad(row, spec, keyId) {
  return spec.contextType === "family"
    ? Buffer.from(`rudra:family-data:v1:${row.organization_id}:${row.centre_id}:${row.record_id}:${spec.field}:${keyId}`)
    : Buffer.from(`rudra:lead-data:v1:${row.organization_id}:${row.centre_id}:${row.record_id}:${spec.field}:${keyId}`);
}

function decrypt(envelope, row, spec, cfg) {
  if (envelope === null) return null;
  const [version, keyId, nonceText, tagText, data, ...extra] = envelope.split(".");
  if (version !== "v1" || !keyId || !nonceText || !tagText || data === undefined || extra.length) throw new Error("Family/lead encryption envelope invalid.");
  const key = Buffer.from(cfg.keys[keyId] ?? "", "base64");
  if (key.length !== 32) throw new Error("Historical family/lead encryption key unavailable.");
  try {
    const nonce = Buffer.from(nonceText, "base64url"), tag = Buffer.from(tagText, "base64url");
    if (nonce.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad(row, spec, keyId));
    decipher.setAuthTag(tag);
    const plainText = Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
    return spec.encoding === "json" ? JSON.parse(plainText) : plainText;
  } catch { throw new Error("Family/lead encryption integrity verification failed."); }
}

function encrypt(value, row, spec, cfg) {
  if (value === null) return null;
  const key = Buffer.from(cfg.keys[cfg.activeId], "base64");
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(row, spec, cfg.activeId));
  const encoded = spec.encoding === "json" ? JSON.stringify(value) : value;
  const ciphertext = Buffer.concat([cipher.update(encoded, "utf8"), cipher.final()]);
  return `v1.${cfg.activeId}.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

export async function rotateFamilyLeadDataKey({ databaseUrl = process.env.DATABASE_TEST_URL, schema = "public", logger = console, interruptAfterFirstBatch = false, batchSize = 100 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("Family/lead key rotation batch size invalid.");
  const cfg = config(databaseUrl, schema);
  const pool = new Pool({ connectionString: cfg.url, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-family-lead-key-rotation", options: `-c search_path=${schema},public` });
  const client = await pool.connect();
  let verified = 0, rotated = 0;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('rudra:family-lead-sensitive-key-rotation:v1',0))");
    for (const spec of tables) {
      let cursor = null;
      for (;;) {
        await client.query("BEGIN");
        try {
          const rows = await client.query(`SELECT "${spec.idColumn}" AS record_id,organization_id,centre_id,"${spec.column}" AS ciphertext FROM "${spec.table}" WHERE "${spec.column}" IS NOT NULL AND ($1::uuid IS NULL OR "${spec.idColumn}" > $1::uuid) ORDER BY "${spec.idColumn}" LIMIT $2 FOR UPDATE SKIP LOCKED`, [cursor, batchSize]);
          if (!rows.rowCount) { await client.query("COMMIT"); break; }
          if (spec.table === "lead_activities" || spec.table === "lead_conversions") await client.query("SELECT set_config('rudra.lead_sensitive_key_rotation','on',true)");
          for (const row of rows.rows) {
            const previousValue = decrypt(row.ciphertext, row, spec, cfg);
            const keyId = row.ciphertext.split(".")[1];
            if (keyId !== cfg.activeId) {
              const nextCiphertext = encrypt(previousValue, row, spec, cfg);
              const updated = await client.query(`UPDATE "${spec.table}" SET "${spec.column}"=$1 WHERE "${spec.idColumn}"=$2 AND "${spec.column}"=$3`, [nextCiphertext, row.record_id, row.ciphertext]);
              if (updated.rowCount !== 1) throw new Error("Family/lead key rotation detected a concurrent record change.");
              if (canonical(decrypt(nextCiphertext, row, spec, cfg)) !== canonical(previousValue)) throw new Error("Family/lead key rotation value verification failed.");
              rotated++;
            }
            cursor = row.record_id;
            verified++;
          }
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
        if (interruptAfterFirstBatch) { interruptAfterFirstBatch = false; throw new Error("synthetic_family_lead_key_rotation_interruption"); }
      }
      const envelopes = await client.query(`SELECT "${spec.idColumn}" AS record_id,organization_id,centre_id,"${spec.column}" AS ciphertext FROM "${spec.table}" WHERE "${spec.column}" IS NOT NULL`);
      for (const row of envelopes.rows) {
        if (row.ciphertext.split(".")[1] !== cfg.activeId) throw new Error("Family/lead key rotation left historical ciphertext in place.");
        decrypt(row.ciphertext, row, spec, cfg);
      }
      logger.log(`${spec.table}.${spec.column}: encrypted value verification complete.`);
    }
    logger.log(`Family/lead encrypted values verified: ${verified}; re-encrypted: ${rotated}.`);
    return { verified, rotated };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended('rudra:family-lead-sensitive-key-rotation:v1',0))").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.error("Use the guarded rotate-family-lead-data-key command, which requires an explicit local confirmation.");
  process.exitCode = 1;
}
