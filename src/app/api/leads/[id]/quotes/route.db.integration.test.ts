import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../../scripts/migrate.mjs";
import { verifyAuditChain } from "@/server/audit-format.mjs";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("lead internal quote PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_lead_quote_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = ""; let pool: InstanceType<typeof Pool> | undefined;
  let post: typeof import("./route").POST; let get: typeof import("./route").GET;
  let organizationId: string; let centreId: string; let otherCentreId: string; let staffId: string; let leadId: string; let otherLeadId: string; let verifiedVersionId: string; let unverifiedVersionId: string;

  beforeAll(async () => {
    loadProjectEnvironment(); testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) throw new Error("A dedicated test database is required.");
    const admin = new Pool({ connectionString: testUrl, max: 1 }); await admin.query(`CREATE SCHEMA "${schema}"`); await admin.end();
    await runMigrations(testUrl, null, schema);
    const scopedUrl = new URL(testUrl); scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`); process.env.DATABASE_URL = scopedUrl.toString(); pool = new Pool({ connectionString: scopedUrl.toString(), max: 1 });
    organizationId = randomUUID(); centreId = randomUUID(); otherCentreId = randomUUID(); staffId = randomUUID(); leadId = randomUUID(); otherLeadId = randomUUID();
    const authUserId = randomUUID(); const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `LQ-${seed}`, "Synthetic quote organization"]);
    for (const [id, code] of [[centreId, `LQ-${seed}`], [otherCentreId, `LQX-${seed}`]]) await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [id, organizationId, code, "Synthetic quote centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authUserId, "Synthetic quote staff", `${seed.toLowerCase()}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [staffId, authUserId, organizationId, `LQ-${seed}`, "Synthetic quote staff"]);
    for (const [id, centre] of [[leadId, centreId], [otherLeadId, otherCentreId]]) await pool.query("INSERT INTO leads(id,organization_id,centre_id,lead_number,enquiry_category,home_collection_interest,source,status,priority,assigned_staff_id,preferred_channel,contact_permission,marketing_consent,created_by_staff_id) VALUES($1,$2,$3,$4,'GENERAL',false,'MANUAL','NEW','NORMAL',$5,'PHONE','PENDING','NOT_REQUESTED',$5)", [id, organizationId, centre, `RHC-L-${id.slice(0, 8)}`, staffId]);
    const verifiedItemId = randomUUID(); verifiedVersionId = randomUUID(); const candidateItemId = randomUUID(); unverifiedVersionId = randomUUID();
    for (const [itemId, versionId, status, price] of [[verifiedItemId, verifiedVersionId, "VERIFIED", "125.05"], [candidateItemId, unverifiedVersionId, "UNVERIFIED", "25.00"]]) {
      await pool.query("INSERT INTO diagnostic_catalogue_items(id,organization_id,centre_id,service_type,service_code,current_version,active,public_visible,created_by_staff_id) VALUES($1,$2,$3,'TEST',$4,1,true,false,$5)", [itemId, organizationId, centreId, `SYN-${versionId.slice(0, 8)}`, staffId]);
      await pool.query("INSERT INTO diagnostic_catalogue_versions(id,organization_id,centre_id,catalogue_item_id,version_number,display_name,verification_status,price_amount,currency,price_source_reference,effective_from,reviewed_by_staff_id,reviewed_at,source_type,created_by_staff_id) VALUES($1,$2,$3,$4,1,'Synthetic price item',$5,$6,'INR','synthetic-reference',CURRENT_DATE,CASE WHEN $5::varchar='VERIFIED' THEN $7::uuid ELSE NULL::uuid END,CASE WHEN $5::varchar='VERIFIED' THEN now() ELSE NULL::timestamptz END,'MANUAL',$7)", [versionId, organizationId, centreId, itemId, status, price, staffId]);
    }
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId: staffId, grants: [{ key: "leads.read", centreId }, { key: "catalogue.read", centreId }, { key: "orders.create", centreId }, { key: "finance.read", centreId }] }, response: null });
    ({ POST: post, GET: get } = await import("./route"));
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ }
    await pool?.end();
    if (testUrl) { const admin = new Pool({ connectionString: testUrl, max: 1 }); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); process.env.DATABASE_URL = testUrl; }
  }, 60_000);

  it("persists a source-backed encrypted versioned draft, excludes promotions, and safely replays", async () => {
    const key = randomUUID(); const body = { catalogueVersionIds: [verifiedVersionId], visitType: "HOME_COLLECTION", homeVisitFeePaise: 7_500 };
    const request = () => new Request(`http://localhost/api/leads/${leadId}/quotes`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });
    const first = await post(request(), { params: Promise.resolve({ id: leadId }) }); expect(first.status).toBe(201); const created = await first.json();
    expect(created.quote).toMatchObject({ quoteNumber: expect.stringContaining("-Q1"), versionNumber: 1, status: "INTERNAL_DRAFT", diagnosticTotalPaise: 12_505, homeVisitFeePaise: 7_500, totalPaise: 20_005 });
    expect(created.quote.snapshot.promotion).toBe("NOT_APPLIED_POLICY_NOT_CONFIGURED"); expect(created.delivery).toBe("DISABLED");
    const replay = await post(request(), { params: Promise.resolve({ id: leadId }) }); expect(replay.status).toBe(200); expect((await replay.json()).replayed).toBe(true);
    const rows = await pool!.query("SELECT count(*)::int AS count, min(version_number) AS version, min(private_snapshot_ciphertext) AS snapshot FROM lead_quotes WHERE lead_id=$1", [leadId]);
    expect(rows.rows[0].count).toBe(1); expect(rows.rows[0].version).toBe(1);
    expect(rows.rows[0].snapshot).toBeTruthy(); expect(rows.rows[0].snapshot).not.toContain('"diagnosticTotalPaise":12505');
    const runtimeRole = await pool!.query("SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app'");
    expect(runtimeRole.rowCount).toBe(1);
    const grants = await pool!.query("SELECT has_table_privilege('rudra_dev_app',$1::regclass,'SELECT') AS can_read, has_table_privilege('rudra_dev_app',$1::regclass,'INSERT') AS can_create, has_table_privilege('rudra_dev_app',$1::regclass,'UPDATE') AS can_update, has_table_privilege('rudra_dev_app',$1::regclass,'DELETE') AS can_delete", [`${schema}.lead_quotes`]);
    expect(grants.rows[0]).toEqual({ can_read: true, can_create: true, can_update: false, can_delete: false });
    const timeline = await get(new Request(`http://localhost/api/leads/${leadId}/quotes`), { params: Promise.resolve({ id: leadId }) }); expect(timeline.status).toBe(200); expect((await timeline.json()).quotes).toHaveLength(1);
    const audit = await pool!.query('SELECT id,organization_id AS "organizationId",centre_id AS "centreId",actor_staff_id AS "actorStaffId",action,entity_type AS "entityType",entity_id AS "entityId",details,previous_hash AS "previousHash",event_hash AS "eventHash",recorded_at AS "recordedAt" FROM audit_events ORDER BY sequence');
    expect(verifyAuditChain(audit.rows)).toMatchObject({ valid: true, verifiedEvents: 1 }); expect(audit.rows[0].details).not.toHaveProperty("leadName");
    await expect(pool!.query("UPDATE lead_quotes SET status='SENT' WHERE lead_id=$1", [leadId])).rejects.toThrow(/append.only/i);
  }, 20_000);

  it("rejects an unverified catalogue price and masks a cross-centre lead", async () => {
    const invalidPrice = await post(new Request(`http://localhost/api/leads/${leadId}/quotes`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ catalogueVersionIds: [unverifiedVersionId], visitType: "CENTRE", homeVisitFeePaise: 0 }) }), { params: Promise.resolve({ id: leadId }) });
    expect(invalidPrice.status).toBe(409); expect((await invalidPrice.json()).error).toBe("catalogue_selection_unavailable");
    const crossCentre = await get(new Request(`http://localhost/api/leads/${otherLeadId}/quotes`), { params: Promise.resolve({ id: otherLeadId }) }); expect(crossCentre.status).toBe(404);
    const count = await pool!.query("SELECT count(*)::int AS count FROM lead_quotes"); expect(count.rows[0].count).toBe(1);
  });
});
