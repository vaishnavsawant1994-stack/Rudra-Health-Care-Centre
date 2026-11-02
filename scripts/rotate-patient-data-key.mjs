import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { loadProjectEnvironment } from "./load-project-env.mjs";

loadProjectEnvironment();
const { Pool } = pg;

function configuration(databaseUrl, schema) {
  const url = new URL(databaseUrl ?? "");
  const development = databaseUrl === process.env.DATABASE_MIGRATION_URL && url.pathname === "/rudra_health_dev";
  const test = databaseUrl === process.env.DATABASE_TEST_URL && url.pathname === "/rudra_health_test" && /^p2_09a_[a-z0-9_]{1,48}$/.test(schema);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || (!development && !test)) throw new Error("Patient key rotation is restricted to local development or a disposable P2-09A test schema.");
  let keys;
  try { keys = JSON.parse(process.env.RUDRA_FIELD_ENCRYPTION_KEYS ?? ""); } catch { throw new Error("Patient encryption keyring unavailable."); }
  if (!keys || typeof keys !== "object" || Array.isArray(keys)) throw new Error("Patient encryption keyring invalid.");
  for (const [id, encoded] of Object.entries(keys)) if (!/^[A-Za-z0-9_-]{1,48}$/.test(id) || typeof encoded !== "string" || !/^[A-Za-z0-9+/]{43}=$/.test(encoded) || Buffer.from(encoded, "base64").length !== 32) throw new Error("Patient encryption keyring invalid.");
  const activeId = process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
  if (!activeId || !keys[activeId]) throw new Error("Active patient encryption key unavailable.");
  return { url: url.toString(), schema, keys, activeId };
}

function aad(field, row, keyId) {
  return Buffer.from(`rudra:patient-contact:v1:${row.organization_id}:${row.centre_id}:${row.patient_id}:${field}:${keyId}`);
}

export function decryptPatientRotationValue(envelope, field, row, cfg) {
  if (typeof envelope !== "string") throw new Error("Patient ciphertext missing.");
  const [version, keyId, nonceText, tagText, data, ...extra] = envelope.split(".");
  if (version !== "v1" || !keyId || keyId !== row.encryption_key_id || !nonceText || !tagText || data === undefined || extra.length) throw new Error("Patient encryption envelope invalid.");
  const key = Buffer.from(cfg.keys[keyId] ?? "", "base64");
  if (key.length !== 32) throw new Error("Historical patient encryption key unavailable.");
  try {
    const nonce = Buffer.from(nonceText, "base64url"), tag = Buffer.from(tagText, "base64url");
    if (nonce.length !== 12 || tag.length !== 16) throw new Error();
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad(field, row, keyId));
    decipher.setAuthTag(tag);
    const text = Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
    return field === "profile" || field === "name" ? JSON.parse(text) : text;
  } catch { throw new Error("Patient encryption integrity verification failed."); }
}

function encryptPatientRotationValue(value, field, row, cfg) {
  const key = Buffer.from(cfg.keys[cfg.activeId], "base64");
  const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, nonce);
  cipher.setAAD(aad(field, row, cfg.activeId));
  const text = field === "profile" || field === "name" ? JSON.stringify(value) : value;
  const ciphertext = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  return `v1.${cfg.activeId}.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

export async function rotatePatientDataKey({ databaseUrl = process.env.DATABASE_TEST_URL, schema = "public", logger = console, interruptAfterFirstBatch = false, batchSize = 100 } = {}) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) throw new Error("Patient key rotation batch size invalid.");
  const cfg = configuration(databaseUrl, schema);
  const pool = new Pool({ connectionString: cfg.url, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-patient-key-rotation", options: `-c search_path=${schema},public` });
  const client = await pool.connect();
  let verified = 0, rotated = 0;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('rudra:patient-sensitive-key-rotation:v1',0))");
    let cursor = null;
    for (;;) {
      await client.query("BEGIN");
      try {
        const batch = await client.query("SELECT patient_id,organization_id,centre_id,encryption_key_id,phone_ciphertext,email_ciphertext,profile_ciphertext,name_ciphertext,phone_blind_index,email_blind_index,first_name_blind_index,last_name_blind_index,full_name_blind_index FROM patient_contact_secrets WHERE ($1::uuid IS NULL OR patient_id > $1::uuid) ORDER BY patient_id LIMIT $2 FOR UPDATE SKIP LOCKED", [cursor, batchSize]);
        if (!batch.rowCount) { await client.query("COMMIT"); break; }
        for (const row of batch.rows) {
          const contextRow = { ...row, id: row.patient_id };
          const values = {
            phone: decryptPatientRotationValue(row.phone_ciphertext, "phone", contextRow, cfg),
            email: row.email_ciphertext === null ? null : decryptPatientRotationValue(row.email_ciphertext, "email", contextRow, cfg),
            profile: decryptPatientRotationValue(row.profile_ciphertext, "profile", contextRow, cfg),
            name: decryptPatientRotationValue(row.name_ciphertext, "name", contextRow, cfg),
          };
          if (row.encryption_key_id !== cfg.activeId) {
            const next = {
              phone: encryptPatientRotationValue(values.phone, "phone", contextRow, cfg),
              email: values.email === null ? null : encryptPatientRotationValue(values.email, "email", contextRow, cfg),
              profile: encryptPatientRotationValue(values.profile, "profile", contextRow, cfg),
              name: encryptPatientRotationValue(values.name, "name", contextRow, cfg),
            };
            const update = await client.query("UPDATE patient_contact_secrets SET encryption_key_id=$1,phone_ciphertext=$2,email_ciphertext=$3,profile_ciphertext=$4,name_ciphertext=$5,updated_at=now() WHERE patient_id=$6 AND encryption_key_id=$7 AND phone_ciphertext=$8 AND email_ciphertext IS NOT DISTINCT FROM $9 AND profile_ciphertext=$10 AND name_ciphertext=$11 AND phone_blind_index=$12 AND email_blind_index IS NOT DISTINCT FROM $13 AND first_name_blind_index=$14 AND last_name_blind_index=$15 AND full_name_blind_index=$16", [cfg.activeId, next.phone, next.email, next.profile, next.name, row.patient_id, row.encryption_key_id, row.phone_ciphertext, row.email_ciphertext, row.profile_ciphertext, row.name_ciphertext, row.phone_blind_index, row.email_blind_index, row.first_name_blind_index, row.last_name_blind_index, row.full_name_blind_index]);
            if (update.rowCount !== 1) throw new Error("Patient key rotation detected a concurrent record change.");
            const reread = { ...row, encryption_key_id: cfg.activeId, ...next };
            for (const field of ["phone", "email", "profile", "name"]) {
              const encrypted = next[field];
              if (encrypted !== null && canonical(decryptPatientRotationValue(encrypted, field, reread, cfg)) !== canonical(values[field])) throw new Error("Patient key rotation value verification failed.");
            }
            rotated++;
          }
          cursor = row.patient_id;
          verified++;
        }
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
      if (interruptAfterFirstBatch) { interruptAfterFirstBatch = false; throw new Error("synthetic_patient_key_rotation_interruption"); }
    }
    const rows = await client.query("SELECT patient_id,organization_id,centre_id,encryption_key_id,phone_ciphertext,email_ciphertext,profile_ciphertext,name_ciphertext FROM patient_contact_secrets ORDER BY patient_id");
    for (const row of rows.rows) {
      if (row.encryption_key_id !== cfg.activeId) throw new Error("Patient key rotation left records using a historical key.");
      const contextRow = { ...row, id: row.patient_id };
      for (const field of ["phone", "email", "profile", "name"]) if (row[`${field}_ciphertext`] !== null && decryptPatientRotationValue(row[`${field}_ciphertext`], field, contextRow, cfg) === undefined) throw new Error("Patient key rotation verification failed.");
    }
    const indexCheck = await client.query("SELECT count(*)::integer AS count FROM patient_contact_secrets WHERE phone_blind_index IS NULL OR first_name_blind_index IS NULL OR last_name_blind_index IS NULL OR full_name_blind_index IS NULL");
    if (indexCheck.rows[0]?.count !== 0) throw new Error("Patient blind-index integrity check failed during key rotation.");
    logger.log(`Patient encrypted records verified: ${verified}; records re-encrypted: ${rotated}.`);
    return { verified, rotated };
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtextextended('rudra:patient-sensitive-key-rotation:v1',0))").catch(() => undefined);
    client.release();
    await pool.end();
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  console.error("Use the guarded rotate-patient-data-key command, which requires an explicit local confirmation.");
  process.exitCode = 1;
}
