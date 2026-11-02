import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../../scripts/migrate.mjs";
import { encryptLeadPrivateData, encryptLeadValue } from "@/server/lead-crypto";
import { encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { verifyAuditChain } from "@/server/audit-format.mjs";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("communication draft cancellation PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_comms_cancel_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool> | undefined;
  let patch: typeof import("./route").PATCH;
  let post: typeof import("./route").POST;
  let getDrafts: typeof import("./route").GET;
  let organizationId: string;
  let centreId: string;
  let staffUserId: string;
  let leadId: string;
  let draftId: string;

  beforeAll(async () => {
    loadProjectEnvironment();
    testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) throw new Error("A dedicated test database is required.");
    const admin = new Pool({ connectionString: testUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    await runMigrations(testUrl, null, schema);
    const scopedUrl = new URL(testUrl);
    scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
    process.env.DATABASE_URL = scopedUrl.toString();
    pool = new Pool({ connectionString: scopedUrl.toString(), max: 1 });

    organizationId = randomUUID(); centreId = randomUUID(); staffUserId = randomUUID(); leadId = randomUUID(); draftId = randomUUID();
    const authUserId = randomUUID(); const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `CD-${seed}`, "Synthetic communication cancellation test"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [centreId, organizationId, `CD-${seed}`, "Synthetic communications centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authUserId, "Synthetic CRM staff", `${seed.toLowerCase()}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [staffUserId, authUserId, organizationId, `CD-${seed}`, "Synthetic CRM staff"]);
    await pool.query("INSERT INTO leads(id,organization_id,centre_id,lead_number,enquiry_category,home_collection_interest,source,status,priority,assigned_staff_id,preferred_channel,contact_permission,marketing_consent,created_by_staff_id) VALUES($1,$2,$3,$4,'GENERAL',false,'MANUAL','NEW','NORMAL',$5,'PHONE','PENDING','NOT_REQUESTED',$5)", [leadId, organizationId, centreId, `RHC-L-${seed}`, staffUserId]);
    const encryptedBody = encryptLeadValue("communication-draft", "Synthetic unsent draft", { organizationId, centreId, recordId: draftId });
    await pool.query("INSERT INTO lead_communication_drafts(id,organization_id,centre_id,lead_id,created_by_staff_id,purpose,channel,status,body_ciphertext,idempotency_key,created_at,updated_at) VALUES($1,$2,$3,$4,$5,'OPERATIONAL','PHONE','DRAFT',$6,$7,now(),'2026-11-01T00:00:00.123456Z')", [draftId, organizationId, centreId, leadId, staffUserId, encryptedBody, randomUUID()]);
    await pool.query("INSERT INTO lead_communication_draft_events(organization_id,centre_id,draft_id,actor_staff_id,event_type) VALUES($1,$2,$3,$4,'CREATED')", [organizationId, centreId, draftId, staffUserId]);
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentreId?: string) => ["leads.activities.write", "leads.followups.manage", "leads.read"].includes(permission) && (!requestedCentreId || requestedCentreId === centreId)
      ? { staff: { organizationId, staffUserId, grants: [{ key: "leads.activities.write", centreId }, { key: "leads.followups.manage", centreId }, { key: "leads.read", centreId }] }, response: null }
      : { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    ({ PATCH: patch, POST: post, GET: getDrafts } = await import("./route"));
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ }
    await pool?.end();
    if (testUrl) { const admin = new Pool({ connectionString: testUrl, max: 1 }); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
    if (testUrl) process.env.DATABASE_URL = testUrl;
  }, 60_000);

  it("cancels against a populated schema, records immutable history and accepts DB microsecond timestamps", async () => {
    const response = await patch(new Request(`http://localhost/api/leads/${leadId}/communications`, {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ draftId, action: "CANCEL", expectedUpdatedAt: "2026-11-01T00:00:00.123Z" }),
    }), { params: Promise.resolve({ id: leadId }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ draft: { id: draftId, status: "CANCELLED", replayed: false } });
    const row = await pool!.query("SELECT status,updated_at FROM lead_communication_drafts WHERE id=$1", [draftId]);
    expect(row.rows[0].status).toBe("CANCELLED");
    const events = await pool!.query("SELECT event_type FROM lead_communication_draft_events WHERE draft_id=$1 ORDER BY recorded_at", [draftId]);
    expect(events.rows.map((event) => event.event_type)).toEqual(["CREATED", "CANCELLED"]);
    const audit = await pool!.query("SELECT id,organization_id AS \"organizationId\",centre_id AS \"centreId\",actor_staff_id AS \"actorStaffId\",action,entity_type AS \"entityType\",entity_id AS \"entityId\",details,previous_hash AS \"previousHash\",event_hash AS \"eventHash\",recorded_at AS \"recordedAt\" FROM audit_events ORDER BY sequence");
    expect(verifyAuditChain(audit.rows)).toMatchObject({ valid: true, verifiedEvents: 1 });
    expect(audit.rows[0].details).toEqual({ draftId, status: "CANCELLED" });
    await expect(pool!.query("UPDATE lead_communication_draft_events SET event_type='CREATED' WHERE draft_id=$1", [draftId])).rejects.toThrow(/append.only/i);
  }, 15_000);

  it("renders an approved scoped template into an encrypted unsent draft with idempotent replay", async () => {
    const now = new Date();
    await pool!.query("UPDATE leads SET preferred_channel='EMAIL',contact_permission='AUTHORIZED',contact_permission_recorded_by=$2,contact_permission_recorded_at=$3 WHERE id=$1", [leadId, staffUserId, now]);
    await pool!.query("INSERT INTO lead_private_data(lead_id,organization_id,centre_id,payload_ciphertext) VALUES($1,$2,$3,$4)", [
      leadId, organizationId, centreId,
      encryptLeadPrivateData({ firstName: "Synthetic", lastName: "Person", phone: null, email: "synthetic@example.invalid", interestedService: "DEMO-TEST-SERVICE", campaign: null, contactEvidenceReference: "SYNTHETIC-EVIDENCE", marketingEvidenceReference: null, lostReason: null }, { organizationId, centreId, recordId: leadId }),
    ]);
    const templateId = randomUUID(); const templateContext = operationalContext({ organizationId, centreId, recordId: templateId }, "communication-template");
    const ciphertext = encryptOperationalData({ name: "Synthetic appointment reminder", body: "Hello {{firstName}} — {{leadNumber}} at {{centreName}} for {{serviceName}}." }, templateContext);
    await pool!.query("INSERT INTO communication_templates(id,organization_id,centre_id,created_by_staff_id,updated_by_staff_id,purpose,channel,status,version_number,private_data_ciphertext,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$4,'OPERATIONAL','EMAIL','ACTIVE',1,$5,$6,$7)", [templateId, organizationId, centreId, staffUserId, ciphertext, randomUUID(), "a".repeat(64)]);
    const idempotencyKey = randomUUID();
    const request = () => new Request(`http://localhost/api/leads/${leadId}/communications`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey, purpose: "OPERATIONAL", channel: "EMAIL", templateId, templateVersion: 1 }) });
    const response = await post(request(), { params: Promise.resolve({ id: leadId }) });
    expect(response.status).toBe(201);
    const created = await response.json();
    expect(created.draft).toMatchObject({ templateId, templateVersion: 1, status: "DRAFT", replayed: false });
    const stored = await pool!.query("SELECT body_ciphertext,template_id,template_version FROM lead_communication_drafts WHERE id=$1", [created.draft.id]);
    expect(stored.rows[0]).toMatchObject({ template_id: templateId, template_version: 1 });
    expect(stored.rows[0].body_ciphertext).not.toContain("Synthetic");
    const listResponse = await getDrafts(new Request(`http://localhost/api/leads/${leadId}/communications`), { params: Promise.resolve({ id: leadId }) });
    expect(listResponse.status).toBe(200);
    const list = await listResponse.json();
    expect(list.drafts[0]).toMatchObject({ id: created.draft.id, templateId, templateVersion: 1, body: expect.stringMatching(/^Hello Synthetic — RHC-L-[A-Z0-9]+ at Synthetic communications centre for DEMO-TEST-SERVICE\.$/) });
    expect(typeof list.drafts[0].updatedAt).toBe("string");
    const replay = await post(request(), { params: Promise.resolve({ id: leadId }) });
    expect(replay.status).toBe(200);
    expect((await replay.json()).draft).toMatchObject({ id: created.draft.id, replayed: true });
    const count = await pool!.query("SELECT count(*)::int AS count FROM lead_communication_drafts WHERE lead_id=$1", [leadId]);
    expect(count.rows[0].count).toBe(2);
  }, 15_000);
});
