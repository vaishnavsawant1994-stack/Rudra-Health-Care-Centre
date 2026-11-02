import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { loadProjectEnvironment } from "./load-project-env.mjs";
loadProjectEnvironment();
const { Pool } = pg;

function config(databaseUrl = process.env.DATABASE_MIGRATION_URL, schema = "public") {
  const url = new URL(databaseUrl ?? ""); const dev = url.pathname === "/rudra_health_dev" && databaseUrl === process.env.DATABASE_MIGRATION_URL; const test = url.pathname === "/rudra_health_test" && databaseUrl === process.env.DATABASE_TEST_URL && (schema === "public" || /^p2_09a_[a-z0-9_]{1,48}$/.test(schema));
  if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || (!dev && !test)) throw new Error("Lead backfill target must be local rudra_health_dev or a disposable P2-09A schema in rudra_health_test.");
  let keys; try { keys = JSON.parse(process.env.RUDRA_FIELD_ENCRYPTION_KEYS ?? ""); } catch { throw new Error("Lead encryption key ring unavailable."); }
  const id = process.env.RUDRA_FIELD_ACTIVE_KEY_ID, key = typeof id === "string" && typeof keys?.[id] === "string" ? Buffer.from(keys[id], "base64") : null, blindKey = Buffer.from(process.env.RUDRA_BLIND_INDEX_KEY ?? "", "base64");
  if (!id || !key || key.length !== 32 || blindKey.length !== 32) throw new Error("Lead encryption or blind-index key invalid or unavailable.");
  return { url: url.toString(), keys, id, key, blindKey, schema };
}
function aad(field, row, id) { return Buffer.from(`rudra:lead-data:v1:${row.organization_id}:${row.centre_id}:${row.id}:${field}:${id}`); }
function encrypt(field, value, row, cfg) { const nonce = randomBytes(12), cipher = createCipheriv("aes-256-gcm", cfg.key, nonce); cipher.setAAD(aad(field, row, cfg.id)); const data = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]); return `v1.${cfg.id}.${nonce.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${data.toString("base64url")}`; }
function decrypt(field, envelope, row, cfg) { if (!envelope) throw new Error("Lead ciphertext missing."); const [version,id,nonceText,tagText,data,...extra] = envelope.split("."); if (version !== "v1" || !id || !nonceText || !tagText || data === undefined || extra.length) throw new Error("Lead encryption envelope invalid."); const key = Buffer.from(cfg.keys[id] ?? "", "base64"); if (key.length !== 32) throw new Error("Historical lead encryption key unavailable."); try { const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(nonceText,"base64url")); decipher.setAAD(aad(field,row,id)); decipher.setAuthTag(Buffer.from(tagText,"base64url")); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(data,"base64url")),decipher.final()]).toString("utf8")); } catch { throw new Error("Lead encryption integrity verification failed."); } }
function index(field,value,cfg) { if (value === null) return null; const normalized=field==="phone"?value.trim().replace(/[ ()-]/g,""):value.trim().toLocaleLowerCase("en-US"); return createHmac("sha256",cfg.blindKey).update(`rudra:lead-contact-index:v1:${field}:`).update(normalized).digest("hex"); }
async function hasColumn(client,schema,table,column) { const r=await client.query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema=$1 AND table_name=$2 AND column_name=$3) AS present",[schema,table,column]); return r.rows[0].present; }

export async function backfillLeadData({ databaseUrl = process.env.DATABASE_MIGRATION_URL, schema = "public", logger = console, interruptAfterFirstBatch = false } = {}) {
  const cfg=config(databaseUrl,schema),pool=new Pool({connectionString:cfg.url,max:1,connectionTimeoutMillis:5000,application_name:"rudra-lead-sensitive-encryption",options:`-c search_path=${schema},public`}),client=await pool.connect(); let processed=0;
  async function batches(selectSql, processRow) {
    for (;;) {
      await client.query("BEGIN"); let committed = false;
      try {
        const result=await client.query(selectSql);
        if(!result.rowCount){await client.query("COMMIT");committed=true;break;}
        for(const row of result.rows) await processRow(row);
        processed+=result.rowCount; await client.query("COMMIT"); committed=true;
      } catch(error) { if(!committed) await client.query("ROLLBACK").catch(()=>undefined); throw error; }
      if(interruptAfterFirstBatch){interruptAfterFirstBatch=false;throw new Error("synthetic_backfill_interruption");}
    }
  }
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended('rudra:lead-sensitive-backfill:v1',0))");
    const hasLeadLegacy=await hasColumn(client,schema,"leads","first_name");
    if(hasLeadLegacy) await batches("SELECT l.id,l.organization_id,l.centre_id,l.first_name,l.last_name,l.phone,l.email,l.interested_service,l.campaign,l.contact_evidence_reference,l.marketing_evidence_reference,l.lost_reason,d.payload_ciphertext,d.phone_blind_index,d.email_blind_index FROM leads l LEFT JOIN lead_private_data d ON d.lead_id=l.id AND d.organization_id=l.organization_id AND d.centre_id=l.centre_id WHERE d.payload_ciphertext IS NULL OR ((l.phone IS NOT NULL) <> (d.phone_blind_index IS NOT NULL)) OR ((l.email IS NOT NULL) <> (d.email_blind_index IS NOT NULL)) ORDER BY l.id LIMIT 100 FOR UPDATE OF l SKIP LOCKED", async(row)=>{
      const payload={firstName:row.first_name,lastName:row.last_name,phone:row.phone,email:row.email,interestedService:row.interested_service,campaign:row.campaign,contactEvidenceReference:row.contact_evidence_reference,marketingEvidenceReference:row.marketing_evidence_reference,lostReason:row.lost_reason};
      if(typeof payload.firstName!=="string"||typeof payload.lastName!=="string")throw new Error("Lead backfill found an invalid synthetic/legacy identity.");
      const envelope=encrypt("private-data",payload,row,cfg),phoneIndex=index("phone",payload.phone,cfg),emailIndex=index("email",payload.email,cfg);
      if(row.payload_ciphertext&&JSON.stringify(decrypt("private-data",row.payload_ciphertext,row,cfg))!==JSON.stringify(payload))throw new Error("Existing encrypted lead payload did not match legacy values.");
      await client.query("INSERT INTO lead_private_data(lead_id,organization_id,centre_id,payload_ciphertext,phone_blind_index,email_blind_index,updated_at) VALUES($1,$2,$3,$4,$5,$6,now()) ON CONFLICT(lead_id) DO UPDATE SET payload_ciphertext=COALESCE(lead_private_data.payload_ciphertext,EXCLUDED.payload_ciphertext),phone_blind_index=EXCLUDED.phone_blind_index,email_blind_index=EXCLUDED.email_blind_index,updated_at=now() WHERE lead_private_data.payload_ciphertext IS NULL OR lead_private_data.phone_blind_index IS DISTINCT FROM EXCLUDED.phone_blind_index OR lead_private_data.email_blind_index IS DISTINCT FROM EXCLUDED.email_blind_index",[row.id,row.organization_id,row.centre_id,envelope,phoneIndex,emailIndex]);
    });
    if(await hasColumn(client,schema,"lead_activities","body")) await batches("SELECT id,organization_id,centre_id,body,metadata,private_payload_ciphertext FROM lead_activities WHERE private_payload_ciphertext IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED",async(row)=>{const value={body:row.body,metadata:row.metadata};if(row.private_payload_ciphertext&&JSON.stringify(decrypt("activity",row.private_payload_ciphertext,row,cfg))!==JSON.stringify(value))throw new Error("Existing encrypted activity did not match legacy values.");await client.query("UPDATE lead_activities SET private_payload_ciphertext=$1 WHERE id=$2 AND private_payload_ciphertext IS NULL",[encrypt("activity",value,row,cfg),row.id]);});
    if(await hasColumn(client,schema,"lead_followups","outcome_note")) await batches("SELECT id,organization_id,centre_id,outcome_note,outcome_note_ciphertext FROM lead_followups WHERE outcome_note IS NOT NULL AND outcome_note_ciphertext IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED",async(row)=>{await client.query("UPDATE lead_followups SET outcome_note_ciphertext=$1 WHERE id=$2 AND outcome_note_ciphertext IS NULL",[encrypt("followup-note",row.outcome_note,row,cfg),row.id]);});
    if(await hasColumn(client,schema,"lead_conversions","identity_evidence_reference")) await batches("SELECT id,organization_id,centre_id,identity_evidence_reference,identity_evidence_ciphertext FROM lead_conversions WHERE identity_evidence_reference IS NOT NULL AND identity_evidence_ciphertext IS NULL ORDER BY id LIMIT 100 FOR UPDATE SKIP LOCKED",async(row)=>{await client.query("UPDATE lead_conversions SET identity_evidence_ciphertext=$1 WHERE id=$2 AND identity_evidence_ciphertext IS NULL",[encrypt("conversion-evidence",row.identity_evidence_reference,row,cfg),row.id]);});

    const leadSelect=hasLeadLegacy?"l.first_name,l.last_name,l.phone,l.email,l.interested_service,l.campaign,l.contact_evidence_reference,l.marketing_evidence_reference,l.lost_reason,":"";
    const leads=await client.query(`SELECT l.id,l.organization_id,l.centre_id,${leadSelect}d.payload_ciphertext,d.phone_blind_index,d.email_blind_index FROM leads l JOIN lead_private_data d ON d.lead_id=l.id AND d.organization_id=l.organization_id AND d.centre_id=l.centre_id`);
    for(const row of leads.rows){const value=decrypt("private-data",row.payload_ciphertext,row,cfg);if(hasLeadLegacy){const legacy={firstName:row.first_name,lastName:row.last_name,phone:row.phone,email:row.email,interestedService:row.interested_service,campaign:row.campaign,contactEvidenceReference:row.contact_evidence_reference,marketingEvidenceReference:row.marketing_evidence_reference,lostReason:row.lost_reason};if(JSON.stringify(value)!==JSON.stringify(legacy))throw new Error("Lead backfill value verification failed.");}if(row.phone_blind_index!==index("phone",value.phone,cfg)||row.email_blind_index!==index("email",value.email,cfg))throw new Error("Lead phone/email blind-index verification failed.");}
    const missing=await client.query("SELECT count(*)::int AS n FROM leads l LEFT JOIN lead_private_data d ON d.lead_id=l.id AND d.organization_id=l.organization_id AND d.centre_id=l.centre_id WHERE d.lead_id IS NULL OR d.payload_ciphertext IS NULL");
    if(missing.rows[0].n)throw new Error("Lead encrypted payload coverage is incomplete.");
    const activities=await client.query("SELECT id,organization_id,centre_id,private_payload_ciphertext FROM lead_activities");for(const row of activities.rows)decrypt("activity",row.private_payload_ciphertext,row,cfg);
    const hasFollowupLegacy=await hasColumn(client,schema,"lead_followups","outcome_note");{const rows=await client.query(`SELECT id,organization_id,centre_id,${hasFollowupLegacy?"outcome_note,":""}outcome_note_ciphertext FROM lead_followups WHERE outcome_note_ciphertext IS NOT NULL`);for(const row of rows.rows){const value=decrypt("followup-note",row.outcome_note_ciphertext,row,cfg);if(hasFollowupLegacy&&value!==row.outcome_note)throw new Error("Lead follow-up note verification failed.");}}
    const hasConversionLegacy=await hasColumn(client,schema,"lead_conversions","identity_evidence_reference");{const rows=await client.query(`SELECT id,organization_id,centre_id,${hasConversionLegacy?"identity_evidence_reference,":""}identity_evidence_ciphertext FROM lead_conversions WHERE identity_evidence_ciphertext IS NOT NULL`);for(const row of rows.rows){const value=decrypt("conversion-evidence",row.identity_evidence_ciphertext,row,cfg);if(hasConversionLegacy&&value!==row.identity_evidence_reference)throw new Error("Lead conversion evidence verification failed.");}}
    logger.log(`Lead/CRM encryption verified for ${leads.rowCount} lead(s), ${activities.rowCount} activity record(s); ${processed} legacy row(s) encrypted.`);
    return {leads:leads.rowCount,activities:activities.rowCount,processed};
  } finally { await client.query("SELECT pg_advisory_unlock(hashtextextended('rudra:lead-sensitive-backfill:v1',0))").catch(()=>undefined);client.release();await pool.end(); }
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){try{await backfillLeadData();}catch(error){console.error(error instanceof Error?error.message:"Lead backfill stopped safely.");process.exitCode=1;}}
