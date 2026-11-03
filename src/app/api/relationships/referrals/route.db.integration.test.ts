import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";
import { sealBusinessRelationship } from "@/server/business-relationship-data";
import { sealDoctorData } from "@/server/doctor-data";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("referral attribution PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_referral_attribution_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool>;
  let dropPool: InstanceType<typeof Pool> | undefined;
  let handler: typeof import("./route").GET;
  let organizationId: string;
  let centreId: string;
  let otherCentreId: string;
  let staffUserId: string;
  let doctorId: string;
  let corporateId: string;
  let partnerId: string;

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

    organizationId = randomUUID(); centreId = randomUUID(); otherCentreId = randomUUID(); staffUserId = randomUUID();
    const authId = randomUUID();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `RA-${organizationId.slice(0, 8)}`, "Synthetic referral attribution"]);
    for (const id of [centreId, otherCentreId]) await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [id, organizationId, `C-${id.slice(0, 8)}`, "Synthetic Centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authId, "Synthetic attribution user", `${authId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)", [staffUserId, authId, organizationId, `ST-${staffUserId.slice(0, 8)}`, "Synthetic attribution user"]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [] }, response: null });
    ({ GET: handler } = await import("./route"));

    doctorId = randomUUID(); corporateId = randomUUID(); partnerId = randomUUID();
    await pool.query("INSERT INTO doctor_profiles(id,organization_id,centre_id,doctor_number,specialty,private_data_ciphertext,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,$3,$4,'Pathology',$5,$6,$6)", [doctorId, organizationId, centreId, `DOC-${doctorId.slice(0, 8)}`, sealDoctorData({ organizationId, centreId, id: doctorId }, { name: "Synthetic Doctor", phone: null, email: null, registrationReference: null, affiliation: null, notes: null }), staffUserId]);
    for (const [id, type, category] of [[corporateId, "CORPORATE", "EMPLOYER"], [partnerId, "PARTNER", "REFERRAL"]] as const) {
      await pool.query("INSERT INTO business_relationships(id,organization_id,centre_id,relationship_type,relationship_number,category,private_data_ciphertext,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$8)", [id, organizationId, centreId, type, `${type}-${id.slice(0, 8)}`, category, sealBusinessRelationship({ organizationId, centreId, id }, type, { name: `Synthetic ${type}`, legalName: null, primaryContactName: null, primaryContactRole: null, phone: null, email: null, address: null, agreementReference: null, agreementStatus: "NOT_RECORDED", notes: null }), staffUserId]);
    }

    const createdAt = new Date("2026-10-15T10:00:00.000Z");
    const sources = [
      { id: randomUUID(), source: "REFERRAL", doctorId, relationshipId: null, relationshipType: null, converted: true },
      { id: randomUUID(), source: "REFERRAL", doctorId, relationshipId: null, relationshipType: null, converted: false },
      { id: randomUUID(), source: "CORPORATE", doctorId: null, relationshipId: corporateId, relationshipType: "CORPORATE", converted: true },
      { id: randomUUID(), source: "PARTNER", doctorId: null, relationshipId: partnerId, relationshipType: "PARTNER", converted: false },
    ] as const;
    for (const item of sources) {
      await pool.query("INSERT INTO leads(id,organization_id,centre_id,lead_number,enquiry_category,source,source_doctor_id,source_relationship_id,source_relationship_type,assigned_staff_id,created_by_staff_id,created_at,updated_at) VALUES($1,$2,$3,$4,'GENERAL',$5,$6,$7,$8,$9,$9,$10,$10)", [item.id, organizationId, centreId, `L-${item.id.slice(0, 8)}`, item.source, item.doctorId, item.relationshipId, item.relationshipType, staffUserId, createdAt]);
      if (item.converted) {
        const patientId = randomUUID();
        await pool.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,created_by_staff_id,created_at) VALUES($1,$2,$3,$4,'NOT_RECORDED',$5,$6)", [patientId, organizationId, centreId, `P-${patientId.slice(0, 8)}`, staffUserId, createdAt]);
        await pool.query("INSERT INTO lead_conversions(id,organization_id,centre_id,lead_id,patient_id,conversion_mode,converted_by_staff_id,converted_at) VALUES($1,$2,$3,$4,$5,'NEW',$6,$7)", [randomUUID(), organizationId, centreId, item.id, patientId, staffUserId, createdAt]);
      }
    }
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ }
    await pool?.end();
    if (testUrl) {
      dropPool = new Pool({ connectionString: testUrl, max: 1 });
      await dropPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await dropPool.end();
      process.env.DATABASE_URL = testUrl;
    }
  }, 60_000);

  it("aggregates each source type and recorded conversions without returning patient data", async () => {
    for (const [type, expectedLeads, expectedConverted] of [["DOCTOR", 2, 1], ["CORPORATE", 1, 1], ["PARTNER", 1, 0]] as const) {
      const response = await handler(new Request(`http://localhost/api/relationships/referrals?centreId=${centreId}&type=${type}&from=2026-10-15&to=2026-10-15`));
      expect(response.status).toBe(200);
      const body = await response.json() as { referrals: Array<{ leads: number; converted: number }> };
      expect(body.referrals).toHaveLength(1);
      expect(body.referrals[0]).toMatchObject({ leads: expectedLeads, converted: expectedConverted });
      expect(JSON.stringify(body)).not.toMatch(/patient|phone|email|Synthetic Doctor/i);
    }
  });

  it("keeps centre and date filters in the aggregate query", async () => {
    const outsideCentre = await handler(new Request(`http://localhost/api/relationships/referrals?centreId=${otherCentreId}&type=DOCTOR`));
    expect(outsideCentre.status).toBe(200);
    expect(await outsideCentre.json()).toMatchObject({ referrals: [] });
    const outsideDate = await handler(new Request(`http://localhost/api/relationships/referrals?centreId=${centreId}&type=DOCTOR&from=2026-10-16&to=2026-10-17`));
    expect(outsideDate.status).toBe(200);
    expect(await outsideDate.json()).toMatchObject({ referrals: [] });
  });
});
