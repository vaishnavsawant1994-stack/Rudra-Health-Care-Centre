import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { loadProjectEnvironment } from "./load-project-env.mjs";
loadProjectEnvironment();
const { Pool } = pg;
const specs = [
  { table: "families", id: "id", field: "display_name", encrypted: "display_name_ciphertext", index: "display_name_blind_index", key: "display-name" },
  { table: "family_members", id: "id", field: "evidence_reference", encrypted: "evidence_ciphertext", key: "member-evidence" },
  { table: "family_access_grants", id: "id", field: "purpose", encrypted: "purpose_ciphertext", key: "grant-purpose" },
  { table: "family_access_grants", id: "id", field: "evidence_reference", encrypted: "evidence_ciphertext", key: "grant-evidence" },
  { table: "family_contact_arrangements", id: "id", field: "evidence_reference", encrypted: "evidence_ciphertext", key: "contact-evidence" },
];
function config(databaseUrl = process.env.DATABASE_MIGRATION_URL, schema = "public") {
  const url = new URL(databaseUrl ?? ""); const dev = url.pathname === "/rudra_health_dev" && databaseUrl === process.env.DATABASE_MIGRATION_URL; const test = url.pathname === "/rudra_health_test" && databaseUrl === process.env.DATABASE_TEST_URL && /^p2_09a_[a-z0-9_]{1,48}$/.test(schema);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || (!dev && !test)) throw new Error("Family backfill target must be local rudra_health_dev or a disposable P2-09A schema in rudra_health_test.");
  let keys; try { keys = JSON.parse(process.env.RUDRA_FIELD_ENCRYPTION_KEYS ?? ""); } catch { throw new Error("Family encryption key ring is unavailable."); }
  const id = process.env.RUDRA_FIELD_ACTIVE_KEY_ID; const key = typeof id === "string" && typeof keys?.[id] === "string" ? Buffer.from(keys[id], "base64") : null; const indexKey = Buffer.from(process.env.RUDRA_BLIND_INDEX_KEY ?? "", "base64");
  if (!id || !key || key.length !== 32 || indexKey.length !== 32) throw new Error("Family encryption or blind-index key is invalid or unavailable.");
  return { url: url.toString(), keys, id, key, indexKey, schema };
}
function aad(row, field, id) { return Buffer.from(`rudra:family-data:v1:${row.organization_id}:${row.centre_id}:${row.id}:${field}:${id}`); }
function encrypt(value, row, field, cfg) { if (value === null) return null; const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", cfg.key, iv); cipher.setAAD(aad(row, field, cfg.id)); const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]); return `v1.${cfg.id}.${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`; }
function decrypt(value, row, field, cfg) { if (value === null) return null; const [v, id, iv, tag, data, ...extra] = value.split("."); if (v !== "v1" || !id || !iv || !tag || data === undefined || extra.length) throw new Error("Family encryption envelope is invalid."); const key = Buffer.from(cfg.keys[id] ?? "", "base64"); if (key.length !== 32) throw new Error("Historical family encryption key unavailable."); try { const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url")); decipher.setAAD(aad(row, field, id)); decipher.setAuthTag(Buffer.from(tag, "base64url")); return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8"); } catch { throw new Error("Family encryption integrity check failed."); } }
function blind(value, cfg) { return createHmac("sha256", cfg.indexKey).update("rudra:family-name-index:v1:").update(value.normalize("NFC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US")).digest("hex"); }

export async function backfillFamilyData({ databaseUrl = process.env.DATABASE_MIGRATION_URL, schema = "public", logger = console } = {}) {
  const cfg = config(databaseUrl, schema); const pool = new Pool({ connectionString: cfg.url, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-family-sensitive-encryption", options: `-c search_path=${schema},public` }); const client = await pool.connect(); let processed = 0;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('rudra:family-sensitive-backfill:v1',0))");
    for (const spec of specs) {
      const hasLegacy = await client.query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3) AS present", [schema, spec.table, spec.field]);
      if (!hasLegacy.rows[0].present) continue;
      const rows = await client.query(`SELECT id,organization_id,centre_id,"${spec.field}" AS legacy,"${spec.encrypted}" AS encrypted${spec.index ? `,"${spec.index}" AS blind_index` : ""} FROM "${spec.table}" ORDER BY id`);
      for (const row of rows.rows) {
        const value = row.legacy;
        if (spec.index && (typeof value !== "string" || !value.trim())) throw new Error("Family name backfill found an invalid display name.");
        if (value !== null && (typeof value !== "string" || !value.length)) throw new Error("Family sensitive-data backfill found an invalid legacy value.");
        const encrypted = encrypt(value, row, spec.key, cfg); const idx = spec.index ? blind(value, cfg) : null;
        if (row.encrypted === null || (spec.index && row.blind_index !== idx)) {
          await client.query(`UPDATE "${spec.table}" SET "${spec.encrypted}"=$1${spec.index ? `,"${spec.index}"=$2` : ""} WHERE id=$${spec.index ? 3 : 2}`, spec.index ? [encrypted, idx, row.id] : [encrypted, row.id]); processed++;
        }
        if (decrypt(row.encrypted ?? encrypted, row, spec.key, cfg) !== value) throw new Error("Family sensitive-data encryption round-trip failed.");
      }
      const cutover = await client.query("SELECT NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3) AS done", [schema, spec.table, spec.field]);
      if (cutover.rows[0].done) {
        const missing = await client.query(`SELECT count(*)::int AS n FROM "${spec.table}" WHERE "${spec.encrypted}" IS NULL`);
        if (missing.rows[0].n) throw new Error("Family encrypted field coverage is incomplete.");
      }
    }
    const families = await client.query("SELECT id,organization_id,centre_id,display_name_ciphertext,display_name_blind_index FROM families");
    for (const row of families.rows) { const value = decrypt(row.display_name_ciphertext, row, "display-name", cfg); if (row.display_name_blind_index !== blind(value, cfg)) throw new Error("Family display-name blind-index verification failed."); }
    for (const spec of specs.filter((entry) => entry.table !== "families")) {
      const rows = await client.query(`SELECT id,organization_id,centre_id,"${spec.encrypted}" AS encrypted FROM "${spec.table}"`);
      for (const row of rows.rows) decrypt(row.encrypted, row, spec.key, cfg);
    }
    logger.log(`Family sensitive-data encryption verified for ${families.rowCount} family record(s); ${processed} field(s) newly encrypted.`);
    return { total: families.rowCount, processed };
  } finally { await client.query("SELECT pg_advisory_unlock(hashtextextended('rudra:family-sensitive-backfill:v1',0))").catch(() => undefined); client.release(); await pool.end(); }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) { try { await backfillFamilyData(); } catch (error) { console.error(error instanceof Error ? error.message : "Family backfill stopped safely."); process.exitCode = 1; } }
