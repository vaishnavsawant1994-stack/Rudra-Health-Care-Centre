import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { loadProjectEnvironment } from "./load-project-env.mjs";

loadProjectEnvironment();
const { Pool } = pg;

function config(databaseUrl = process.env.DATABASE_MIGRATION_URL, schema = "public") {
  const url = new URL(databaseUrl ?? "");
  const validDev = url.pathname === "/rudra_health_dev" && databaseUrl === process.env.DATABASE_MIGRATION_URL;
  const validTest = url.pathname === "/rudra_health_test" && databaseUrl === process.env.DATABASE_TEST_URL && /^p2_09a_[a-z0-9_]{1,48}$/.test(schema);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || (!validDev && !validTest)) throw new Error("Patient name backfill target must be local rudra_health_dev or a disposable P2-09A schema in rudra_health_test.");
  let keys;
  try { keys = JSON.parse(process.env.RUDRA_FIELD_ENCRYPTION_KEYS ?? ""); } catch { throw new Error("Patient encryption key ring is unavailable."); }
  const id = process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
  const key = typeof id === "string" && typeof keys?.[id] === "string" ? Buffer.from(keys[id], "base64") : null;
  const blindRaw = process.env.RUDRA_BLIND_INDEX_KEY;
  const blindKey = typeof blindRaw === "string" ? Buffer.from(blindRaw, "base64") : null;
  if (!id || !key || key.length !== 32 || !blindKey || blindKey.length !== 32) throw new Error("Patient name or blind-index key is invalid or unavailable.");
  return { url: url.toString(), id, key, keys, blindKey, schema };
}

function aad(row, keyId) { return Buffer.from(`rudra:patient-contact:v1:${row.organization_id}:${row.centre_id}:${row.id}:name:${keyId}`); }
function encrypt(identity, row, cfg) {
  const iv = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", cfg.key, iv); cipher.setAAD(aad(row, cfg.id));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(identity), "utf8"), cipher.final()]);
  return `v1.${cfg.id}.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${ciphertext.toString("base64url")}`;
}
function decrypt(envelope, row, cfg) {
  const [version, id, ivText, tagText, data, ...extra] = (envelope ?? "").split(".");
  if (version !== "v1" || !id || !ivText || !tagText || data === undefined || extra.length) throw new Error("Patient name encryption envelope is invalid.");
  const key = typeof cfg.keys?.[id] === "string" ? Buffer.from(cfg.keys[id], "base64") : null;
  if (!key || key.length !== 32) throw new Error("A required historical patient name key is unavailable.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(ivText, "base64url")); decipher.setAAD(aad(row, id)); decipher.setAuthTag(Buffer.from(tagText, "base64url"));
    const identity = JSON.parse(Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8"));
    if (!identity || typeof identity.firstName !== "string" || typeof identity.lastName !== "string") throw new Error();
    return { firstName: identity.firstName, lastName: identity.lastName };
  } catch { throw new Error("Patient name encryption integrity check failed."); }
}
function normalized(value) { return value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US"); }
function index(cfg, field, value) { return createHmac("sha256", cfg.blindKey).update(`rudra:patient-name-index:v1:${field}:`).update(normalized(value)).digest("hex"); }
function values(row, cfg) {
  const first = row.first_name.trim(); const last = row.last_name.trim();
  return { nameCiphertext: encrypt({ firstName: first, lastName: last }, row, cfg), first: index(cfg, "first", first), last: index(cfg, "last", last), full: index(cfg, "full", `${first} ${last}`) };
}
function same(a, b) { return a.firstName === b.firstName && a.lastName === b.lastName; }

export async function backfillPatientNames({ databaseUrl = process.env.DATABASE_MIGRATION_URL, schema = "public", logger = console } = {}) {
  const cfg = config(databaseUrl, schema); const pool = new Pool({ connectionString: cfg.url, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-patient-name-encryption", options: `-c search_path=${schema},public` }); const client = await pool.connect(); let processed = 0;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('rudra:patient-name-backfill:v1',0))");
    const legacy = await client.query("SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name='patients' AND column_name='first_name') AS present", [schema]);
    if (legacy.rows[0].present) {
      for (;;) {
        await client.query("BEGIN");
        try {
          const batch = await client.query("SELECT p.id,p.organization_id,p.centre_id,p.first_name,p.last_name FROM patients p JOIN patient_contact_secrets s ON s.patient_id=p.id AND s.organization_id=p.organization_id AND s.centre_id=p.centre_id WHERE s.name_ciphertext IS NULL ORDER BY p.id LIMIT 100 FOR UPDATE OF p SKIP LOCKED");
          if (!batch.rowCount) { await client.query("COMMIT"); break; }
          for (const row of batch.rows) {
            if (typeof row.first_name !== "string" || !row.first_name.trim() || typeof row.last_name !== "string" || !row.last_name.trim()) throw new Error("Patient name backfill encountered an invalid legacy record.");
            const encrypted = values(row, cfg);
            await client.query("UPDATE patient_contact_secrets SET name_ciphertext=$1,first_name_blind_index=$2,last_name_blind_index=$3,full_name_blind_index=$4,updated_at=now() WHERE patient_id=$5 AND name_ciphertext IS NULL", [encrypted.nameCiphertext, encrypted.first, encrypted.last, encrypted.full, row.id]);
            const check = await client.query("SELECT s.name_ciphertext FROM patient_contact_secrets s WHERE s.patient_id=$1", [row.id]);
            if (!same(decrypt(check.rows[0].name_ciphertext, row, cfg), { firstName: row.first_name.trim(), lastName: row.last_name.trim() })) throw new Error("Patient name encryption round-trip failed.");
            processed++;
          }
          await client.query("COMMIT");
        } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
      }
    }
    const rows = await client.query(`SELECT p.id,p.organization_id,p.centre_id,${legacy.rows[0].present ? "p.first_name,p.last_name," : ""} s.name_ciphertext,s.first_name_blind_index,s.last_name_blind_index,s.full_name_blind_index FROM patients p JOIN patient_contact_secrets s ON s.patient_id=p.id AND s.organization_id=p.organization_id AND s.centre_id=p.centre_id`);
    for (const row of rows.rows) {
      const identity = decrypt(row.name_ciphertext, row, cfg);
      if (legacy.rows[0].present && !same(identity, { firstName: row.first_name.trim(), lastName: row.last_name.trim() })) throw new Error("Patient name backfill verification failed.");
      const first = index(cfg, "first", identity.firstName), last = index(cfg, "last", identity.lastName), full = index(cfg, "full", `${identity.firstName} ${identity.lastName}`);
      if (row.first_name_blind_index !== first || row.last_name_blind_index !== last || row.full_name_blind_index !== full) throw new Error("Patient name blind-index verification failed.");
    }
    const missing = await client.query("SELECT count(*)::int AS count FROM patients p LEFT JOIN patient_contact_secrets s ON s.patient_id=p.id AND s.organization_id=p.organization_id AND s.centre_id=p.centre_id WHERE s.patient_id IS NULL OR s.name_ciphertext IS NULL OR s.first_name_blind_index IS NULL OR s.last_name_blind_index IS NULL OR s.full_name_blind_index IS NULL");
    if (missing.rows[0].count) throw new Error("Patient name encryption coverage is incomplete.");
    logger.log(`Patient name encryption verified for ${rows.rowCount} record(s); ${processed} newly encrypted. Legacy names remain until migration 0030.`);
    return { total: rows.rowCount, processed };
  } finally { await client.query("SELECT pg_advisory_unlock(hashtextextended('rudra:patient-name-backfill:v1',0))").catch(() => undefined); client.release(); await pool.end(); }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await backfillPatientNames(); } catch (error) { console.error(error instanceof Error ? error.message : "Patient name backfill stopped safely."); process.exitCode = 1; }
}
