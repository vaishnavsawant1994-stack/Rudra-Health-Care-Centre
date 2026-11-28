import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("relationship aggregate pipeline PostgreSQL scope", () => {
  const { Pool } = pg;
  const schema = `p2_09a_relationship_pipeline_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  let testUrl = "";
  let oldUrl: string | undefined;
  let pool: InstanceType<typeof Pool>;
  let organizationId: string;
  let centreId: string;
  let otherCentreId: string;
  let staffId: string;
  let handler: typeof import("./route").GET;

  beforeAll(async () => {
    loadProjectEnvironment();
    testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) throw new Error("A dedicated PostgreSQL test database is required.");
    oldUrl = process.env.DATABASE_URL;
    const admin = new Pool({ connectionString: testUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`); await admin.end();
    await runMigrations(testUrl, null, schema);
    const scoped = new URL(testUrl); scoped.searchParams.set("options", `-csearch_path=${schema},public`); process.env.DATABASE_URL = scoped.toString();
    pool = new Pool({ connectionString: scoped.toString(), max: 1 });
    organizationId = randomUUID(); centreId = randomUUID(); otherCentreId = randomUUID(); staffId = randomUUID(); const authId = randomUUID();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `RP-${organizationId.slice(0, 8)}`, "Synthetic relationships pipeline"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata'),($5,$2,$6,$7,'Asia/Kolkata')", [centreId, organizationId, `RC-${centreId.slice(0, 8)}`, "Synthetic centre A", otherCentreId, `RC-${otherCentreId.slice(0, 8)}`, "Synthetic centre B"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authId, "Synthetic Relationship Reviewer", `${authId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',true)", [staffId, authId, organizationId, `RS-${staffId.slice(0, 8)}`, "Synthetic Relationship Reviewer"]);
    const grants = ["doctors.read", "corporate.read", "partners.read"].map(key => ({ key, centreId }));
    mocks.getApiAccess.mockImplementation(async (_permission: string, requested?: string) => requested && requested !== centreId
      ? { staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) }
      : { staff: { organizationId, staffUserId: staffId, grants }, response: null });
    for (const [index, status] of ["ACTIVE", "INACTIVE"] .entries()) await pool.query("INSERT INTO doctor_profiles(id,organization_id,centre_id,doctor_number,specialty,status,private_data_ciphertext,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,$3,$4,'Synthetic specialty',$5,'SYNTHETIC-CIPHERTEXT',$6,$6)", [randomUUID(), organizationId, centreId, `SYN-D-${index}`, status, staffId]);
    for (const [index, type] of ["CORPORATE", "PARTNER"].entries()) await pool.query("INSERT INTO business_relationships(id,organization_id,centre_id,relationship_type,relationship_number,category,status,private_data_ciphertext,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,$3,$4,$5,'SYNTHETIC','ACTIVE','SYNTHETIC-CIPHERTEXT',$6,$6)", [randomUUID(), organizationId, centreId, type, `SYN-R-${index}`, staffId]);
    await pool.query("INSERT INTO doctor_profiles(id,organization_id,centre_id,doctor_number,specialty,status,private_data_ciphertext,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,$3,$4,'Out of scope','ACTIVE','SHOULD-NOT-LEAK',$5,$5)", [randomUUID(), organizationId, otherCentreId, `SYN-OUT-${otherCentreId.slice(0, 6)}`, staffId]);
    ({ GET: handler } = await import("./route"));
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ }
    await pool?.end();
    if (testUrl) { const admin = new Pool({ connectionString: testUrl, max: 1 }); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
    if (oldUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = oldUrl;
  }, 30_000);

  it("returns only authorized status/category aggregates and excludes cross-centre rows and contact fields", async () => {
    const response = await handler(new Request(`http://localhost/api/relationships/pipeline?centreId=${centreId}`));
    const body = await response.json() as { relationships: Record<string, Array<{ status: string; category?: string; count: number }>>; contractStages: string };
    expect(response.status).toBe(200);
    expect(body.relationships.doctors).toEqual([{ status: "ACTIVE", count: 1 }, { status: "INACTIVE", count: 1 }]);
    expect(body.relationships.corporate).toEqual([{ status: "ACTIVE", category: "SYNTHETIC", count: 1 }]);
    expect(body.relationships.partners).toEqual([{ status: "ACTIVE", category: "SYNTHETIC", count: 1 }]);
    expect(body.contractStages).toContain("UNAVAILABLE");
    expect(JSON.stringify(body)).not.toContain("SHOULD-NOT-LEAK");
    expect(JSON.stringify(body)).not.toContain("SYNTHETIC-CIPHERTEXT");
  });

  it("denies another centre before any cross-centre aggregate query is issued", async () => {
    const before = mocks.getApiAccess.mock.calls.length;
    const response = await handler(new Request(`http://localhost/api/relationships/pipeline?centreId=${otherCentreId}`));
    expect(response.status).toBe(403);
    expect(mocks.getApiAccess.mock.calls.length - before).toBe(3);
  });

  it("aggregates an unselected centre only across the operator's granted centre scope", async () => {
    const response = await handler(new Request("http://localhost/api/relationships/pipeline"));
    const body = await response.json() as { relationships: Record<string, Array<{ count: number }>> };
    expect(response.status).toBe(200);
    expect(body.relationships.doctors.reduce((total, row) => total + row.count, 0)).toBe(2);
    expect(body.relationships.corporate.reduce((total, row) => total + row.count, 0)).toBe(1);
    expect(body.relationships.partners.reduce((total, row) => total + row.count, 0)).toBe(1);
  });
});
