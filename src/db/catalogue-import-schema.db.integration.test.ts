import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { loadProjectEnvironment } from "../../scripts/load-project-env.mjs";
import { runMigrations } from "../../scripts/migrate.mjs";
import { catalogueImportBatches, cataloguePriceReviews, dispatchBatchItems, sampleProcedureApprovals, specimens } from "./schema";

describe("catalogue import Drizzle schema PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_catalogue_import_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool>;
  let dropPool: InstanceType<typeof Pool> | undefined;
  let organizationId: string;
  let centreId: string;
  let staffId: string;

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
    pool = new Pool({ connectionString: scopedUrl.toString(), max: 1 });
    organizationId = randomUUID(); centreId = randomUUID(); staffId = randomUUID();
    const authId = randomUUID();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `CI-${organizationId.slice(0, 8)}`, "Synthetic catalogue import"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [centreId, organizationId, `CI-${centreId.slice(0, 8)}`, "Synthetic catalogue centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authId, "Synthetic importer", `${authId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',true)", [staffId, authId, organizationId, `CI-${staffId.slice(0, 8)}`, "Synthetic importer"]);
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (testUrl) {
      dropPool = new Pool({ connectionString: testUrl, max: 1 });
      await dropPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await dropPool.end();
    }
  });

  it("inserts and reads the imported_at timestamp through the real ORM mapping", async () => {
    const db = drizzle(pool);
    const [batch] = await db.insert(catalogueImportBatches).values({
      organizationId,
      centreId,
      fileDigest: "a".repeat(64),
      rowCount: 1,
      sourceReference: "synthetic integration fixture",
      importedByStaffId: staffId,
    }).returning({ id: catalogueImportBatches.id, importedAt: catalogueImportBatches.importedAt });

    expect(batch.id).toBeTruthy();
    expect(batch.importedAt).toBeInstanceOf(Date);
    const [stored] = await db.select({ importedAt: catalogueImportBatches.importedAt }).from(catalogueImportBatches);
    expect(stored.importedAt.getTime()).toBe(batch.importedAt.getTime());

    await expect(db.select({ reviewedAt: cataloguePriceReviews.reviewedAt }).from(cataloguePriceReviews).limit(0)).resolves.toEqual([]);
    await expect(db.select({ approvedAt: sampleProcedureApprovals.approvedAt }).from(sampleProcedureApprovals).limit(0)).resolves.toEqual([]);
    await expect(db.select({ collectedAt: specimens.collectedAt }).from(specimens).limit(0)).resolves.toEqual([]);
    await expect(db.select({ addedAt: dispatchBatchItems.addedAt }).from(dispatchBatchItems).limit(0)).resolves.toEqual([]);
  }, 30_000);
});
