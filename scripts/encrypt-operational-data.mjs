import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { loadProjectEnvironment } from "./load-project-env.mjs";
loadProjectEnvironment();
const { Pool } = pg;
const TABLES = [
  ["appointments", "appointment", ["home_collection_address", "collection_instructions", "communication_evidence_reference", "home_charge_reason"]],
  ["appointment_services", "appointment-service", ["service_name", "service_reference"]],
  ["appointment_status_history", "appointment-status-history", ["reason"]],
  ["appointment_assignment_history", "appointment-assignment-history", ["reason"]],
  ["collection_job_events", "collection-job-event", ["reason", "evidence_reference"]],
  ["specimens", "specimen", ["specimen_type", "requirement_reference"]],
  ["dispatch_batches", "dispatch-batch", ["carrier_reference", "external_lab_reference"]],
  ["sample_custody_events", "sample-custody-event", ["evidence_reference", "reason"]],
  ["sample_external_receipts", "sample-external-receipt", ["receipt_reference", "evidence_reference"]],
  ["sample_exceptions", "sample-exception", ["reason", "resolution_reference"]],
];
function config(databaseUrl, schema) {
  const url = new URL(databaseUrl ?? "");
  const dev = url.pathname === "/rudra_health_dev" && databaseUrl === process.env.DATABASE_MIGRATION_URL;
  const test = url.pathname === "/rudra_health_test" && databaseUrl === process.env.DATABASE_TEST_URL && (schema === "public" || /^p2_09a_[a-z0-9_]{1,48}$/.test(schema));
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || (!dev && !test)) throw new Error("Operational backfill target must be local dev or an isolated P2-09A test schema.");
  let keys; try { keys = JSON.parse(process.env.RUDRA_FIELD_ENCRYPTION_KEYS ?? ""); } catch { throw new Error("Operational encryption key ring unavailable."); }
  const active = process.env.RUDRA_FIELD_ACTIVE_KEY_ID, key = active && typeof keys?.[active] === "string" ? Buffer.from(keys[active], "base64") : null;
  if (!active || key?.length !== 32) throw new Error("Operational encryption key invalid or unavailable.");
  return { url: url.toString(), schema, keys, active, key };
}
function context(row, type, keyId) { return Buffer.from(`rudra:operational-data:v1:${row.organization_id}:${row.centre_id}:${type}:${row.id}:${keyId}`); }
function encrypt(value, row, type, cfg) { const nonce = randomBytes(12), c = createCipheriv("aes-256-gcm", cfg.key, nonce); c.setAAD(context(row, type, cfg.active)); const data = Buffer.concat([c.update(JSON.stringify(value), "utf8"), c.final()]); return `v1.${cfg.active}.${nonce.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${data.toString("base64url")}`; }
export function decryptOperationalEnvelope(value, row, type, cfg) { if (!value) throw new Error("Operational ciphertext missing."); const [v,k,n,t,d,...x] = value.split("."); if(v!=="v1"||!k||!n||!t||d===undefined||x.length) throw new Error("Operational encryption envelope invalid.");const key=Buffer.from(cfg.keys[k]??"","base64");if(key.length!==32)throw new Error("Historical operational encryption key unavailable.");try{const dc=createDecipheriv("aes-256-gcm",key,Buffer.from(n,"base64url"));dc.setAAD(context(row,type,k));dc.setAuthTag(Buffer.from(t,"base64url"));return JSON.parse(Buffer.concat([dc.update(Buffer.from(d,"base64url")),dc.final()]).toString("utf8"));}catch{throw new Error("Operational encryption integrity verification failed.");} }
async function columns(client,schema,table){const r=await client.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2",[schema,table]);return new Set(r.rows.map(x=>x.column_name));}
const camel = (name) => name.replace(/_([a-z])/g, (_m, c) => c.toUpperCase());
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}
export async function backfillOperationalData({databaseUrl=process.env.DATABASE_MIGRATION_URL,schema="public",logger=console,interruptAfterFirstBatch=false}={}) {
  const cfg=config(databaseUrl,schema), pool=new Pool({connectionString:cfg.url,max:1,connectionTimeoutMillis:5000,application_name:"rudra-operational-encryption",options:`-c search_path=${schema},public`}), client=await pool.connect();let processed=0;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('rudra:operational-sensitive-backfill:v1',0))");
    for(const [table,type,legacyFields] of TABLES){
      const cols=await columns(client,schema,table);if(!cols.has("private_data_ciphertext"))continue;
      const activeLegacy=legacyFields.filter(f=>cols.has(f));const projection=activeLegacy.length?`,${activeLegacy.map(f=>`"${f}"`).join(",")}`:"";
      for(;;){await client.query("BEGIN");let stop=false;try{
        const rows=await client.query(`SELECT id,organization_id,centre_id,private_data_ciphertext${projection} FROM "${table}" WHERE private_data_ciphertext IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED`);
        if(!rows.rowCount){await client.query("COMMIT");stop=true;}else{
          for(const row of rows.rows){const payload={};for(const f of legacyFields)payload[camel(f)]=cols.has(f)?row[f]??null:null;const envelope=encrypt(payload,row,type,cfg);await client.query(`UPDATE "${table}" SET private_data_ciphertext=$1 WHERE id=$2 AND private_data_ciphertext IS NULL`,[envelope,row.id]);processed++;}
          await client.query("COMMIT");
        }
      }catch(e){await client.query("ROLLBACK").catch(()=>{});throw e;}if(stop)break;if(interruptAfterFirstBatch){interruptAfterFirstBatch=false;throw new Error("synthetic_backfill_interruption");}}
      const all=await client.query(`SELECT id,organization_id,centre_id,private_data_ciphertext${projection} FROM "${table}" ORDER BY id`);
      for(const row of all.rows){const decrypted=decryptOperationalEnvelope(row.private_data_ciphertext,row,type,cfg);for(const f of activeLegacy)if(canonical(decrypted[camel(f)])!==canonical(row[f]))throw new Error(`Operational value verification failed for ${table}.`);}
      logger.log(`${table}: verified ${all.rowCount} row(s).`);
    }
    logger.log(`Operational encryption backfill verified; ${processed} row(s) encrypted during this run.`);return {processed};
  } finally {await client.query("SELECT pg_advisory_unlock(hashtextextended('rudra:operational-sensitive-backfill:v1',0))").catch(()=>{});client.release();await pool.end();}
}

/** Re-encrypts operational private payloads to the active key without changing event data. */
export async function rotateOperationalDataKey({databaseUrl=process.env.DATABASE_TEST_URL,schema="public",logger=console,interruptAfterFirstBatch=false}={}) {
  const cfg=config(databaseUrl,schema), pool=new Pool({connectionString:cfg.url,max:1,connectionTimeoutMillis:5000,application_name:"rudra-operational-key-rotation",options:`-c search_path=${schema},public`}), client=await pool.connect();
  let verified=0,rotated=0;
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('rudra:operational-sensitive-key-rotation:v1',0))");
    for(const [table,type] of TABLES){
      const cols=await columns(client,schema,table);if(!cols.has("private_data_ciphertext"))continue;
      let cursor=null;
      for(;;){
        await client.query("BEGIN");
        try{
          const batch=await client.query(`SELECT id,organization_id,centre_id,private_data_ciphertext FROM "${table}" WHERE ($1::uuid IS NULL OR id > $1::uuid) ORDER BY id LIMIT 100 FOR UPDATE`,[cursor]);
          if(!batch.rowCount){await client.query("COMMIT");break;}
          await client.query("SELECT set_config('rudra.operational_data_key_rotation','on',true)");
          for(const row of batch.rows){
            const plaintext=decryptOperationalEnvelope(row.private_data_ciphertext,row,type,cfg);
            const currentKeyId=row.private_data_ciphertext.split(".")[1];
            if(currentKeyId!==cfg.active){
              const replacement=encrypt(plaintext,row,type,cfg);
              const updated=await client.query(`UPDATE "${table}" SET private_data_ciphertext=$1 WHERE id=$2 AND private_data_ciphertext=$3`,[replacement,row.id,row.private_data_ciphertext]);
              if(updated.rowCount!==1)throw new Error("Operational key rotation encountered a concurrent record change.");
              rotated++;
            }
            verified++;cursor=row.id;
          }
          await client.query("COMMIT");
        }catch(error){await client.query("ROLLBACK").catch(()=>{});throw error;}
        if(interruptAfterFirstBatch){interruptAfterFirstBatch=false;throw new Error("synthetic_operational_key_rotation_interruption");}
      }
      const stale=await client.query(`SELECT count(*)::integer AS count FROM "${table}" WHERE split_part(private_data_ciphertext,'.',2) <> $1`,[cfg.active]);
      if(stale.rows[0]?.count!==0)throw new Error("Operational key rotation found records still encrypted with a historical key.");
      logger.log(`${table}: encrypted payload verification complete.`);
    }
    return {verified,rotated};
  }finally{await client.query("SELECT pg_advisory_unlock(hashtextextended('rudra:operational-sensitive-key-rotation:v1',0))").catch(()=>{});client.release();await pool.end();}
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{await backfillOperationalData();}catch(error){console.error(error instanceof Error?error.message:"Operational backfill stopped safely.");process.exitCode=1;}}
