import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../scripts/load-project-env.mjs";
import { runMigrations } from "../../scripts/migrate.mjs";

describe("public catalogue detail PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_public_catalogue_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool>;
  let getPublicCatalogueItem: typeof import("./public-catalogue").getPublicCatalogueItem;
  let organizationId: string;
  let centreId: string;
  let staffId: string;
  let packageItemId: string;
  let hiddenItemId: string;

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
    organizationId = randomUUID(); centreId = randomUUID(); staffId = randomUUID();
    const authUserId = randomUUID();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `PUB-${organizationId.slice(0, 8)}`, "Synthetic public catalogue"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [centreId, organizationId, `PC-${centreId.slice(0, 8)}`, "Synthetic Public Centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authUserId, "Synthetic Catalogue Reviewer", `${authUserId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',true)", [staffId, authUserId, organizationId, `PS-${staffId.slice(0, 8)}`, "Synthetic Catalogue Reviewer"]);

    const goodTestItemId = randomUUID(); const goodTestVersionId = randomUUID();
    const privateTestVersionId = randomUUID(); const expiredTestVersionId = randomUUID();
    packageItemId = randomUUID(); const packageVersionId = randomUUID();
    hiddenItemId = randomUUID();
    const insertItem = async (id: string, serviceType: "TEST" | "PACKAGE", code: string, visible: boolean) => pool.query(
      "INSERT INTO diagnostic_catalogue_items(id,organization_id,centre_id,service_type,service_code,current_version,active,public_visible,created_by_staff_id) VALUES($1,$2,$3,$4,$5,1,true,$6,$7)",
      [id, organizationId, centreId, serviceType, code, visible, staffId],
    );
    const insertVersion = async (id: string, itemId: string, name: string, price: string, effective: "CURRENT" | "EXPIRED") => pool.query(
      "INSERT INTO diagnostic_catalogue_versions(id,organization_id,centre_id,catalogue_item_id,version_number,display_name,verification_status,price_amount,currency,price_source_reference,effective_from,effective_until,reviewed_by_staff_id,reviewed_at,source_type,created_by_staff_id) VALUES($1,$2,$3,$4,1,$5,'VERIFIED',$6,'INR','synthetic-source',CASE WHEN $7='CURRENT' THEN CURRENT_DATE ELSE CURRENT_DATE-2 END,CASE WHEN $7='CURRENT' THEN CURRENT_DATE+30 ELSE CURRENT_DATE-1 END,$8,now(),'MANUAL',$8)",
      [id, organizationId, centreId, itemId, name, price, effective, staffId],
    );

    await insertItem(goodTestItemId, "TEST", "SYN-TEST-PUBLIC", true);
    await insertVersion(goodTestVersionId, goodTestItemId, "Synthetic published test", "125.00", "CURRENT");
    const privateItemId = randomUUID();
    await insertItem(privateItemId, "TEST", "SYN-TEST-HIDDEN", false);
    await insertVersion(privateTestVersionId, privateItemId, "Synthetic unpublished test", "99.00", "CURRENT");
    const expiredItemId = randomUUID();
    await insertItem(expiredItemId, "TEST", "SYN-TEST-EXPIRED", true);
    await insertVersion(expiredTestVersionId, expiredItemId, "Synthetic expired test", "80.00", "EXPIRED");
    await insertItem(packageItemId, "PACKAGE", "SYN-PACKAGE-PUBLIC", true);
    await insertVersion(packageVersionId, packageItemId, "Synthetic package", "300.00", "CURRENT");
    await pool.query("INSERT INTO diagnostic_package_components(organization_id,centre_id,package_version_id,test_version_id) VALUES($1,$2,$3,$4),($1,$2,$3,$5),($1,$2,$3,$6)", [organizationId, centreId, packageVersionId, goodTestVersionId, privateTestVersionId, expiredTestVersionId]);
    await insertItem(hiddenItemId, "PACKAGE", "SYN-PACKAGE-HIDDEN", false);
    await insertVersion(randomUUID(), hiddenItemId, "Synthetic unpublished package", "400.00", "CURRENT");
    ({ getPublicCatalogueItem } = await import("./public-catalogue"));
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool already closed */ }
    await pool?.end();
    if (testUrl) {
      const admin = new Pool({ connectionString: testUrl, max: 1 });
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    if (testUrl) process.env.DATABASE_URL = testUrl;
  });

  it("returns current public detail and only currently public verified package components", async () => {
    const detail = await getPublicCatalogueItem(packageItemId);
    expect(detail).toMatchObject({ id: packageItemId, serviceType: "PACKAGE", displayName: "Synthetic package", priceAmount: "300.00" });
    expect(detail?.includedTests).toEqual([{ id: expect.any(String), serviceCode: "SYN-TEST-PUBLIC", displayName: "Synthetic published test", specimenRequirements: null, preparationInstructions: null }]);
  });

  it("does not return unpublished package or expired test records", async () => {
    expect(await getPublicCatalogueItem(hiddenItemId)).toBeNull();
    for (let index = 0; index < 55; index += 1) {
      const itemId = randomUUID(); const versionId = randomUUID(); const code = `SYN-TEST-PAGE-${String(index).padStart(2, "0")}`;
      await pool.query("INSERT INTO diagnostic_catalogue_items(id,organization_id,centre_id,service_type,service_code,current_version,active,public_visible,created_by_staff_id) VALUES($1,$2,$3,'TEST',$4,1,true,true,$5)", [itemId, organizationId, centreId, code, staffId]);
      await pool.query("INSERT INTO diagnostic_catalogue_versions(id,organization_id,centre_id,catalogue_item_id,version_number,display_name,verification_status,price_amount,currency,price_source_reference,effective_from,reviewed_by_staff_id,reviewed_at,source_type,created_by_staff_id) VALUES($1,$2,$3,$4,1,$5,'VERIFIED','125.00','INR','synthetic-source',CURRENT_DATE,$6,now(),'MANUAL',$6)", [versionId, organizationId, centreId, itemId, `Synthetic page test ${String(index).padStart(2, "0")}`, staffId]);
    }
    const { listPublicCatalogue } = await import("./public-catalogue");
    const first = await listPublicCatalogue({ centreId, serviceType: "TEST", page: 1, pageSize: 50 });
    const second = await listPublicCatalogue({ centreId, serviceType: "TEST", page: 2, pageSize: 50 });
    expect(first.items).toHaveLength(50);
    expect(first).toMatchObject({ page: 1, pageSize: 50, hasMore: true });
    expect(second.items).toHaveLength(6);
    expect(second).toMatchObject({ page: 2, pageSize: 50, hasMore: false });
    expect(first.items.some((item) => second.items.some((next) => next.id === item.id))).toBe(false);
    expect([...first.items, ...second.items].map((item) => item.serviceCode)).toContain("SYN-TEST-PUBLIC");
    expect([...first.items, ...second.items].map((item) => item.serviceCode)).not.toContain("SYN-TEST-HIDDEN");
  });

  it("returns every eligible centre without silently truncating the public directory", async () => {
    const centreIds = Array.from({ length: 100 }, () => randomUUID());
    const itemIds = centreIds.map(() => randomUUID());
    const versionIds = centreIds.map(() => randomUUID());
    const codes = centreIds.map((_, index) => `SYN-PUB-CENTRE-${String(index).padStart(3, "0")}`);
    const names = centreIds.map((_, index) => `Synthetic Public Centre ${String(index).padStart(3, "0")}`);

    await pool.query(
      "INSERT INTO centres(id,organization_id,code,name,time_zone) SELECT id,$2,code,name,'Asia/Kolkata' FROM unnest($1::uuid[],$3::text[],$4::text[]) AS centre_rows(id,code,name)",
      [centreIds, organizationId, codes, names],
    );
    await pool.query(
      "INSERT INTO diagnostic_catalogue_items(id,organization_id,centre_id,service_type,service_code,current_version,active,public_visible,created_by_staff_id) SELECT item_id,$2,centre_id,'TEST',service_code,1,true,true,$3 FROM unnest($1::uuid[],$4::uuid[],$5::text[]) AS item_rows(item_id,centre_id,service_code)",
      [itemIds, organizationId, staffId, centreIds, codes.map((code) => `${code}-TEST`)],
    );
    await pool.query(
      "INSERT INTO diagnostic_catalogue_versions(id,organization_id,centre_id,catalogue_item_id,version_number,display_name,verification_status,price_amount,currency,price_source_reference,effective_from,reviewed_by_staff_id,reviewed_at,source_type,created_by_staff_id) SELECT version_id,$2,centre_id,item_id,1,display_name,'VERIFIED','125.00','INR','synthetic-source',CURRENT_DATE,$3,now(),'MANUAL',$3 FROM unnest($1::uuid[],$4::uuid[],$5::uuid[],$6::text[]) AS version_rows(version_id,centre_id,item_id,display_name)",
      [versionIds, organizationId, staffId, centreIds, itemIds, names.map((name) => `${name} verified test`)],
    );

    const { listPublicCatalogueCentres } = await import("./public-catalogue");
    const result = await listPublicCatalogueCentres();
    expect(result).toHaveLength(101);
    expect(result.map((centre) => centre.id)).toContain(centreIds[99]);
    expect(result.map((centre) => centre.code)).toContain(codes[99]);
  });

  it("shows only an explicitly published encrypted public profile and never copies private centre address data", async () => {
    const { encryptCentrePublicProfile } = await import("./centre-public-profile");
    const { listPublicCatalogueCentres } = await import("./public-catalogue");
    const beforePublish = (await listPublicCatalogueCentres()).find((centre) => centre.id === centreId);
    expect(beforePublish?.publicProfile).toBeNull();
    const publicProfile = { displayName: "Synthetic Public Listing", address: "Synthetic public address", phone: "+910000000002", email: "public@invalid.test", serviceArea: "Synthetic service area", openingHours: "Synthetic hours", published: true };
    const ciphertext = encryptCentrePublicProfile(publicProfile, organizationId, centreId);
    expect(ciphertext).not.toContain(publicProfile.address);
    await pool.query("UPDATE centres SET address = $2::jsonb WHERE id = $1", [centreId, JSON.stringify({ line1: "PRIVATE LEGACY ADDRESS" })]);
    await pool.query("INSERT INTO centre_public_profiles(organization_id,centre_id,profile_ciphertext,published,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,$3,true,$4,$4)", [organizationId, centreId, ciphertext, staffId]);
    const listed = (await listPublicCatalogueCentres()).find((centre) => centre.id === centreId);
    expect(listed).toMatchObject({ name: publicProfile.displayName, publicProfile: { address: publicProfile.address, phone: publicProfile.phone, email: publicProfile.email, serviceArea: publicProfile.serviceArea, openingHours: publicProfile.openingHours } });
    expect(JSON.stringify(listed)).not.toContain("PRIVATE LEGACY ADDRESS");
  });

  it("offers published active centres for enquiries even when no verified catalogue item is available", async () => {
    const { encryptCentrePublicProfile } = await import("./centre-public-profile");
    const { listPublicEnquiryCentres } = await import("./public-enquiry-centres");
    const availableId = randomUUID();
    const unpublishedId = randomUUID();
    const inactiveId = randomUUID();
    await pool.query("INSERT INTO centres(id,organization_id,code,name,status) VALUES($1,$4,'SYN-ENQ-A','Synthetic enquiry centre','ACTIVE'),($2,$4,'SYN-ENQ-U','Synthetic unpublished centre','ACTIVE'),($3,$4,'SYN-ENQ-I','Synthetic inactive centre','SUSPENDED')", [availableId, unpublishedId, inactiveId, organizationId]);
    const publishedProfile = { displayName: "Synthetic Enquiry Centre", address: "Synthetic public address", phone: null, email: null, serviceArea: null, openingHours: null, published: true };
    const unpublishedProfile = { ...publishedProfile, displayName: "Hidden Enquiry Centre", published: false };
    const inactiveProfile = { ...publishedProfile, displayName: "Inactive Enquiry Centre" };
    await pool.query("INSERT INTO centre_public_profiles(organization_id,centre_id,profile_ciphertext,published,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,$3,true,$4,$4),($1,$5,$6,false,$4,$4),($1,$7,$8,true,$4,$4)", [
      organizationId,
      availableId,
      encryptCentrePublicProfile(publishedProfile, organizationId, availableId),
      staffId,
      unpublishedId,
      encryptCentrePublicProfile(unpublishedProfile, organizationId, unpublishedId),
      inactiveId,
      encryptCentrePublicProfile(inactiveProfile, organizationId, inactiveId),
    ]);

    const result = await listPublicEnquiryCentres();
    expect(result).toContainEqual({ id: availableId, code: "SYN-ENQ-A", name: publishedProfile.displayName });
    expect(result.map((centre) => centre.id)).toContain(centreId);
    expect(result.map((centre) => centre.id)).not.toContain(unpublishedId);
    expect(result.map((centre) => centre.id)).not.toContain(inactiveId);
    expect(JSON.stringify(result)).not.toContain("Synthetic public address");
  });
});
