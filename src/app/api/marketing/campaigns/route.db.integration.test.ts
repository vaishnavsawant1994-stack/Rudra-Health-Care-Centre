import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("marketing campaign conversion metrics PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_campaign_metrics_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool>;
  let handler: typeof import("./route").GET;
  let organizationId: string;
  let centreId: string;
  let otherCentreId: string;
  let staffUserId: string;

  beforeAll(async () => {
    loadProjectEnvironment();
    testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) throw new Error("A dedicated PostgreSQL test database is required.");
    const admin = new Pool({ connectionString: testUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    await runMigrations(testUrl, null, schema);
    const scopedUrl = new URL(testUrl);
    scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
    process.env.DATABASE_URL = scopedUrl.toString();
    pool = new Pool({ connectionString: scopedUrl.toString(), max: 2 });

    organizationId = randomUUID();
    centreId = randomUUID();
    otherCentreId = randomUUID();
    staffUserId = randomUUID();
    const authId = randomUUID();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `CM-${organizationId.slice(0, 8)}`, "Synthetic campaign metrics"]);
    for (const id of [centreId, otherCentreId]) await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [id, organizationId, `C-${id.slice(0, 8)}`, "Synthetic Centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authId, "Synthetic campaign reader", `${authId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [staffUserId, authId, organizationId, `ST-${staffUserId.slice(0, 8)}`, "Synthetic campaign reader"]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "marketing.read", centreId }] }, response: null });
    ({ GET: handler } = await import("./route"));
  }, 60_000);

  afterAll(async () => {
    await pool?.end();
    const { closeDatabasePool } = await import("@/db/client");
    await closeDatabasePool();
    if (testUrl) {
      const admin = new Pool({ connectionString: testUrl, max: 1 });
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    if (testUrl) process.env.DATABASE_URL = testUrl;
  }, 60_000);

  it("counts only centre-matched recorded conversions and uses attributed leads as denominator", async () => {
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    const campaignIds = [randomUUID(), randomUUID(), randomUUID()];
    const campaignRows = [
      { id: campaignIds[0]!, centre: centreId, code: "SYN-A", name: "Synthetic campaign A" },
      { id: campaignIds[1]!, centre: centreId, code: "SYN-B", name: "Synthetic campaign B" },
      { id: campaignIds[2]!, centre: otherCentreId, code: "SYN-X", name: "Other centre campaign" },
    ];
    for (const campaign of campaignRows) {
      const ciphertext = encryptOperationalData({ name: campaign.name, description: null }, operationalContext({ organizationId, centreId: campaign.centre, recordId: campaign.id }, "marketing-campaign"));
      await pool.query("INSERT INTO marketing_campaigns(id,organization_id,centre_id,campaign_code,channel,status,private_data_ciphertext,created_by_staff_id,updated_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'WEBSITE','ACTIVE',$5,$6,$6,$7,$8)", [campaign.id, organizationId, campaign.centre, campaign.code, ciphertext, staffUserId, randomUUID(), "a".repeat(64)]);
    }
    const leadsForA = [0, 1, 2].map(() => randomUUID());
    const leadForB = randomUUID();
    const leadForOtherCentre = randomUUID();
    for (const [index, leadId] of leadsForA.entries()) await pool.query("INSERT INTO leads(id,organization_id,centre_id,lead_number,enquiry_category,source,status,assigned_staff_id,created_by_staff_id,marketing_campaign_id,converted_at,created_at,updated_at) VALUES($1,$2,$3,$4,'GENERAL','CAMPAIGN',$5,$6,$6,$7,$8,$9,$9)", [leadId, organizationId, centreId, `LA-${leadId.slice(0, 8)}`, index < 2 ? "CONVERTED" : "NEW", staffUserId, campaignIds[0], index < 2 ? new Date("2026-11-02T00:00:00Z") : null, new Date(["2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z", "2026-09-30T00:00:00Z"][index]!)]);
    for (const [leadId, targetCentre, campaignId, code] of [[leadForB, centreId, campaignIds[1], "LB"], [leadForOtherCentre, otherCentreId, campaignIds[2], "LX"]] as const) await pool.query("INSERT INTO leads(id,organization_id,centre_id,lead_number,enquiry_category,source,assigned_staff_id,created_by_staff_id,marketing_campaign_id,created_at,updated_at) VALUES($1,$2,$3,$4,'GENERAL','CAMPAIGN',$5,$5,$6,now(),now())", [leadId, organizationId, targetCentre, `${code}-${leadId.slice(0, 8)}`, staffUserId, campaignId]);
    for (const leadId of [leadsForA[0]!, leadsForA[1]!]) {
      const patientId = randomUUID();
      await pool.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',$5)", [patientId, organizationId, centreId, `P-${patientId.slice(0, 8)}`, staffUserId]);
      await pool.query("INSERT INTO lead_conversions(id,organization_id,centre_id,lead_id,patient_id,conversion_mode,converted_by_staff_id) VALUES($1,$2,$3,$4,$5,'NEW',$6)", [randomUUID(), organizationId, centreId, leadId, patientId, staffUserId]);
    }

    const response = await handler(new Request(`http://localhost/api/marketing/campaigns?centreId=${centreId}`));
    expect(response.status).toBe(200);
    const body = await response.json() as { campaigns: Array<{ campaignCode: string; attributedLeadCount: number; convertedLeadCount: number; conversionRatePercent: number | null }> };
    expect(body.campaigns).toHaveLength(2);
    expect(body.campaigns.find((campaign) => campaign.campaignCode === "SYN-A")).toMatchObject({ attributedLeadCount: 3, convertedLeadCount: 2, conversionRatePercent: 66.7 });
    expect(body.campaigns.find((campaign) => campaign.campaignCode === "SYN-B")).toMatchObject({ attributedLeadCount: 1, convertedLeadCount: 0, conversionRatePercent: 0 });
    expect(JSON.stringify(body)).not.toContain(leadForOtherCentre);
    expect(JSON.stringify(body)).not.toContain(staffUserId);

    const cohortResponse = await handler(new Request(`http://localhost/api/marketing/campaigns?centreId=${centreId}&from=2026-10-01&to=2026-10-01`));
    expect(cohortResponse.status).toBe(200);
    const cohort = await cohortResponse.json() as { attributionWindow: { from: string; to: string; basis: string }; campaigns: Array<{ campaignCode: string; attributedLeadCount: number; convertedLeadCount: number; conversionRatePercent: number | null }> };
    expect(cohort.attributionWindow).toEqual({ from: "2026-10-01", to: "2026-10-01", basis: "LEAD_CREATED_COHORT" });
    expect(cohort.campaigns.find((campaign) => campaign.campaignCode === "SYN-A")).toMatchObject({ attributedLeadCount: 1, convertedLeadCount: 1, conversionRatePercent: 100 });
    expect(cohort.campaigns.find((campaign) => campaign.campaignCode === "SYN-B")).toMatchObject({ attributedLeadCount: 0, convertedLeadCount: 0, conversionRatePercent: null });
  });
});
