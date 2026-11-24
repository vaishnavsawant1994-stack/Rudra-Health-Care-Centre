import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";
import { backupSchema, protectRecoveryDirectory, resolvePostgresTools, restoreSchema } from "../../../../../scripts/isolated-postgres-recovery.mjs";
import { decryptKeyBackup, encryptKeyBackup } from "../../../../../scripts/key-recovery.mjs";
import { openBusinessRelationship } from "@/server/business-relationship-data";
import { encryptCentrePublicProfile } from "@/server/centre-public-profile";
import { blindIndexLeadContact, decryptLeadPrivateData, decryptLeadValue, encryptLeadValue } from "@/server/lead-crypto";
import { legacyPublicEnquiryFingerprint, publicEnquiryContext, publicEnquiryCreateSchema, type PublicEnquiryPayload } from "@/server/public-enquiry-policy";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), listPublicCatalogueCentres: vi.fn(), getPublicCatalogueItem: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/server/public-catalogue", () => ({ listPublicCatalogueCentres: mocks.listPublicCatalogueCentres, getPublicCatalogueItem: mocks.getPublicCatalogueItem }));

describe("public enquiry PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_public_enquiry_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  let recoverySchema: string | undefined;
  let recoveryTempDir = "";
  let testUrl = "";
  let priorDatabaseUrl: string | undefined;
  let pool: InstanceType<typeof Pool>;
  let dropPool: InstanceType<typeof Pool> | undefined;
  let post: typeof import("./route").POST;
  let get: typeof import("./route").GET;
  let patch: typeof import("./route").PATCH;
  let getLead: typeof import("../../leads/[id]/route").GET;
  let updateLead: typeof import("../../leads/[id]/route").PATCH;
  let convertLead: typeof import("../../leads/[id]/convert/route").POST;
  let createAppointment: typeof import("../../appointments/route").POST;
  let createOrder: typeof import("../../orders/route").POST;
  let createCollectionJob: typeof import("../../collections/route").POST;
  let updateAppointment: typeof import("../../appointments/[id]/route").PATCH;
  let verifyCatalogue: typeof import("../../catalogue/[id]/verify/route").POST;
  let updateOrder: typeof import("../../orders/[id]/route").PATCH;
  let updateCollectionJob: typeof import("../../collections/[id]/route").PATCH;
  let sampleAction: typeof import("../../samples/route").POST;
  let createDispatchBatch: typeof import("../../samples/dispatch/route").POST;
  let dispatchAction: typeof import("../../samples/dispatch/[id]/route").POST;
  let registerReport: typeof import("../../reports/route").POST;
  let uploadReportDocument: typeof import("../../reports/[id]/documents/route").POST;
  let readReportDocument: typeof import("../../reports/[id]/documents/route").GET;
  let getFinance: typeof import("../../finance/route").GET;
  let postFinance: typeof import("../../finance/route").POST;
  let organizationId: string;
  let centreId: string;
  let staffUserId: string;
  let grants: string[];

  beforeAll(async () => {
    loadProjectEnvironment();
    testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) throw new Error("A dedicated test database is required.");
    priorDatabaseUrl = process.env.DATABASE_URL;
    dropPool = new Pool({ connectionString: testUrl, max: 1 });
    await dropPool.query(`CREATE SCHEMA "${schema}"`);
    await runMigrations(testUrl, null, schema);
    const scopedUrl = new URL(testUrl); scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`); process.env.DATABASE_URL = scopedUrl.toString();
    pool = new Pool({ connectionString: scopedUrl.toString(), max: 1 });
    organizationId = randomUUID(); centreId = randomUUID(); staffUserId = randomUUID();
    const authUserId = randomUUID(), roleId = randomUUID();
    const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `WEB-${seed}`, "Synthetic public enquiry test"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name) VALUES($1,$2,$3,$4)", [centreId, organizationId, `WEB-${seed}`, "Synthetic web centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authUserId, "Synthetic Web Reviewer", `${seed.toLowerCase()}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status) VALUES($1,$2,$3,$4,$5,'ACTIVE')", [staffUserId, authUserId, organizationId, `WEB-${seed}`, "Synthetic Web Reviewer"]);
    await pool.query("INSERT INTO roles(id,organization_id,key,name,scope) VALUES($1,$2,$3,$4,'CENTRE')", [roleId, organizationId, `web_${seed.toLowerCase()}`, "Synthetic web review"]);
    await pool.query("INSERT INTO permissions(key,description,scope) VALUES('leads.read','Synthetic lead read','CENTRE'),('leads.create','Synthetic lead create','CENTRE'),('leads.update','Synthetic lead update','CENTRE') ON CONFLICT(key) DO NOTHING");
    await pool.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key IN ('leads.read','leads.create','leads.update') ON CONFLICT DO NOTHING", [roleId]);
    await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, staffUserId, roleId, centreId]);
    grants = ["leads.read", "leads.create", "leads.update", "leads.convert", "patients.create", "patients.read", "appointments.create", "appointments.read", "orders.create", "collections.assign"];
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentreId?: string) => {
      if (requestedCentreId && requestedCentreId !== centreId) return { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null };
      if (!grants.includes(permission)) return { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null };
      return { response: null, staff: { organizationId, staffUserId, grants: grants.map((key) => ({ key, centreId })) } };
    });
    mocks.listPublicCatalogueCentres.mockResolvedValue([{ id: centreId, code: `WEB-${seed}`, name: "Synthetic web centre" }]);
    ({ POST: post, GET: get, PATCH: patch } = await import("./route"));
    ({ GET: getLead } = await import("../../leads/[id]/route"));
    ({ PATCH: updateLead } = await import("../../leads/[id]/route"));
    ({ POST: convertLead } = await import("../../leads/[id]/convert/route"));
    ({ POST: createAppointment } = await import("../../appointments/route"));
    ({ POST: createOrder } = await import("../../orders/route"));
    ({ POST: createCollectionJob } = await import("../../collections/route"));
    ({ PATCH: updateAppointment } = await import("../../appointments/[id]/route"));
    ({ POST: verifyCatalogue } = await import("../../catalogue/[id]/verify/route"));
    ({ PATCH: updateOrder } = await import("../../orders/[id]/route"));
    ({ PATCH: updateCollectionJob } = await import("../../collections/[id]/route"));
    ({ POST: sampleAction } = await import("../../samples/route"));
    ({ POST: createDispatchBatch } = await import("../../samples/dispatch/route"));
    ({ POST: dispatchAction } = await import("../../samples/dispatch/[id]/route"));
    ({ POST: registerReport } = await import("../../reports/route"));
    ({ POST: uploadReportDocument, GET: readReportDocument } = await import("../../reports/[id]/documents/route"));
    ({ GET: getFinance, POST: postFinance } = await import("../../finance/route"));
  }, 30_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ }
    if (pool) await pool.end();
    if (dropPool) {
      if (recoverySchema) await dropPool.query(`DROP SCHEMA IF EXISTS "${recoverySchema}" CASCADE`);
      await dropPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await dropPool.end();
    }
    if (recoveryTempDir) await rm(recoveryTempDir, { recursive: true, force: true });
    if (priorDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = priorDatabaseUrl;
  }, 60_000);

  const submit = (key: string, phone = "+919876543210", selectedCentreId = centreId, extra: Record<string, unknown> = {}) => new Request("http://localhost/api/public/enquiries", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify({ centreId: selectedCentreId, firstName: "Synthetic", lastName: "Enquirer", phone, category: "GENERAL", message: "Please call about diagnostic service availability.", responsePermission: true, ...extra }) });

  it("pages through every public enquiry without overlap and keeps row details permission-scoped", async () => {
    const records = Array.from({ length: 55 }, () => {
      const id = randomUUID();
      const privateData = { firstName: "Synthetic", lastName: "Queue", phone: null, email: null, category: "GENERAL", requestTopic: "GENERAL", message: "Synthetic review queue item", requestKind: "INQUIRY", requestedService: null, preferredDate: null, preferredTimeWindow: null, visitType: null, collectionAddress: null, responsePermission: false, responsePermissionTextVersion: "PUBLIC_ENQUIRY_RESPONSE_V1", submittedAt: new Date().toISOString() };
      return { id, privateData };
    });
    for (const { id, privateData } of records) {
      await pool.query("INSERT INTO public_enquiries(id,organization_id,centre_id,enquiry_number,status,private_data_ciphertext,idempotency_key,request_fingerprint,reviewed_by_staff_id,reviewed_at) VALUES($1,$2,$3,$4,'DISMISSED',$5,$6,$7,$8,now())", [id, organizationId, centreId, `RHC-W-${id.slice(0, 8).toUpperCase()}`, encryptLeadValue("private-data", privateData, publicEnquiryContext({ organizationId, centreId, id })), randomUUID(), "d".repeat(64), staffUserId]);
    }
    const first = await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}&status=DISMISSED&page=1`));
    const firstBody = await first.json() as { enquiries: Array<{ id: string; firstName: string }>; page: number; pageSize: number; hasMore: boolean };
    expect(first.status).toBe(200);
    expect(firstBody).toMatchObject({ page: 1, pageSize: 50, hasMore: true });
    expect(firstBody.enquiries).toHaveLength(50);
    expect(firstBody.enquiries[0]).toMatchObject({ firstName: "Synthetic" });
    const second = await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}&status=DISMISSED&page=2`));
    const secondBody = await second.json() as { enquiries: Array<{ id: string }>; page: number; pageSize: number; hasMore: boolean };
    expect(second.status).toBe(200);
    expect(secondBody).toMatchObject({ page: 2, pageSize: 50, hasMore: false });
    expect(secondBody.enquiries).toHaveLength(5);
    expect(new Set([...firstBody.enquiries, ...secondBody.enquiries].map((row) => row.id)).size).toBe(55);
    const historicalId = records[0].id;
    const historical = await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}&enquiryId=${historicalId}`));
    const historicalBody = await historical.json() as { enquiries: Array<{ id: string; status: string; firstName: string; message: string }> };
    expect(historical.status).toBe(200);
    expect(historicalBody.enquiries).toHaveLength(1);
    expect(historicalBody.enquiries[0]).toMatchObject({ id: historicalId, status: "DISMISSED", firstName: "Synthetic", message: "Synthetic review queue item" });
    const unavailable = await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}&enquiryId=${randomUUID()}`));
    expect(unavailable.status).toBe(200);
    expect(await unavailable.json()).toMatchObject({ enquiries: [], page: 1, pageSize: 1, hasMore: false });
    const crossCentre = await get(new Request(`http://localhost/api/public/enquiries?centreId=${randomUUID()}&enquiryId=${historicalId}`));
    expect(crossCentre.status).toBe(403);
    expect(await crossCentre.json()).toEqual({ error: "forbidden" });
    const invalid = await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}&page=0`));
    expect(invalid.status).toBe(400);
    const invalidCombination = await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}&enquiryId=${historicalId}&summary=true`));
    expect(invalidCombination.status).toBe(400);
  });

  it("rejects an unknown public enquiry topic without storing a submission", async () => {
    const key = randomUUID();
    const response = await post(submit(key, "+919876543299", centreId, { requestTopic: "UNVERIFIED_PARTNER" }));
    expect(response.status).toBe(400);
    const stored = await pool.query("SELECT 1 FROM public_enquiries WHERE organization_id=$1 AND idempotency_key=$2", [organizationId, key]);
    expect(stored.rows).toHaveLength(0);
  });

  it("accepts a manual enquiry for a published active centre without a catalogue listing", async () => {
    const profileCiphertext = encryptCentrePublicProfile({ displayName: "Synthetic Public Centre", address: "1 Synthetic Road", phone: null, email: null, serviceArea: null, openingHours: null, published: true }, organizationId, centreId);
    await pool.query("INSERT INTO centre_public_profiles(organization_id,centre_id,profile_ciphertext,published,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,$3,true,$4,$4)", [organizationId, centreId, profileCiphertext, staffUserId]);
    mocks.listPublicCatalogueCentres.mockResolvedValue([]);

    const key = randomUUID();
    const response = await post(submit(key, "+919876543299", centreId, { requestedService: "Manual service enquiry" }));
    expect(response.status).toBe(202);
    const receipt = await response.json() as { accepted: boolean; reference: string; receiptId: string };
    expect(receipt).toMatchObject({ accepted: true });
    expect(Object.keys(receipt).sort()).toEqual(["accepted", "receiptId", "reference"]);
    expect(receipt.receiptId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    const stored = await pool.query("SELECT id,centre_id,status,private_data_ciphertext FROM public_enquiries WHERE organization_id=$1 AND idempotency_key=$2", [organizationId, key]);
    expect(stored.rows).toHaveLength(1);
    expect(receipt.receiptId).toBe(stored.rows[0].id);
    expect(stored.rows[0]).toMatchObject({ centre_id: centreId, status: "PENDING_REVIEW" });
    expect(stored.rows[0].private_data_ciphertext).not.toContain("Manual service enquiry");

    mocks.listPublicCatalogueCentres.mockResolvedValue([{ id: centreId, code: "SYN-CENTRE", name: "Synthetic public centre" }]);
  });

  it("serializes concurrent public submissions by encrypted contact and preserves idempotent retry", async () => {
    const phone = "+919876543220";
    const keys = Array.from({ length: 6 }, () => randomUUID());
    const responses = await Promise.all(keys.map((key) => post(submit(key, phone))));
    expect(responses.map((response) => response.status).sort()).toEqual([202, 202, 202, 202, 202, 429]);
    const acceptedIndex = responses.findIndex((response) => response.status === 202);
    const initial = await responses[acceptedIndex].json() as { reference: string };
    const retry = await post(submit(keys[acceptedIndex], phone));
    expect(retry.status).toBe(202);
    expect(await retry.json()).toEqual(initial);
    const contactIndex = blindIndexLeadContact("phone", phone);
    const stored = await pool.query("SELECT id FROM public_enquiries WHERE organization_id=$1 AND phone_blind_index=$2 AND created_at >= now() - interval '1 day'", [organizationId, contactIndex]);
    expect(stored.rows).toHaveLength(5);
  });

  it("serves a minimized communications queue projection without exposing encrypted enquiry details", async () => {
    const key = randomUUID();
    const accepted = await post(submit(key, "+919876543299", centreId, { message: "Synthetic private queue message" }));
    expect(accepted.status, JSON.stringify(await accepted.clone().json())).toBe(202);
    const reference = (await accepted.json() as { reference: string }).reference;
    const response = await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}&summary=true`));
    const body = await response.json() as { enquiries: Array<Record<string, unknown>>; pageSize: number };
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const summary = body.enquiries.find((item) => item.reference === reference);
    expect(summary).toMatchObject({ reference, status: "PENDING_REVIEW", centreId });
    expect(Object.keys(summary ?? {}).sort()).toEqual(["centreId", "createdAt", "id", "reference", "status"]);
    expect(JSON.stringify(body)).not.toContain("Synthetic private queue message");
    expect(JSON.stringify(body)).not.toContain("+919876543299");
  });

  it("revalidates a selected public service at its centre and stores the canonical version in encrypted intake", async () => {
    const catalogueItemId = randomUUID();
    mocks.getPublicCatalogueItem.mockResolvedValue({ id: catalogueItemId, centreId, version: 4, serviceCode: "SYN-TEST-04", displayName: "Synthetic Verified Test" });
    const key = randomUUID();
    const selected = await post(submit(key, "+919876543245", centreId, { requestKind: "BOOKING_REQUEST", category: "TEST", requestedService: "tampered browser label", requestedCatalogueItemId: catalogueItemId, requestedCatalogueVersion: 4, preferredDate: "2027-02-02" }));
    expect(selected.status).toBe(202);
    const reference = (await selected.json() as { reference: string }).reference;
    const [stored] = (await pool.query("SELECT id,private_data_ciphertext FROM public_enquiries WHERE enquiry_number=$1", [reference])).rows;
    expect(stored.private_data_ciphertext).not.toContain("Synthetic Verified Test");
    const listed = await (await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}`))).json() as { enquiries: Array<{ id: string; requestedService: string; requestedCatalogueItemId: string; requestedCatalogueVersion: number }> };
    expect(listed.enquiries.find((item) => item.id === stored.id)).toMatchObject({ requestedService: "Synthetic Verified Test (SYN-TEST-04)", requestedCatalogueItemId: catalogueItemId, requestedCatalogueVersion: 4 });

    mocks.getPublicCatalogueItem.mockResolvedValue({ id: catalogueItemId, centreId: randomUUID(), version: 4, serviceCode: "SYN-TEST-04", displayName: "Synthetic Verified Test" });
    const rejectedKey = randomUUID();
    const rejected = await post(submit(rejectedKey, "+919876543246", centreId, { requestedCatalogueItemId: catalogueItemId, requestedCatalogueVersion: 4 }));
    expect(rejected.status).toBe(400);
    expect(await rejected.json()).toEqual({ error: "catalogue_selection_unavailable" });
    expect((await pool.query("SELECT id FROM public_enquiries WHERE organization_id=$1 AND idempotency_key=$2", [organizationId, rejectedKey])).rows).toHaveLength(0);

    mocks.getPublicCatalogueItem.mockResolvedValue({ id: catalogueItemId, centreId, version: 5, serviceCode: "SYN-TEST-04", displayName: "Synthetic Verified Test" });
    const staleKey = randomUUID();
    const stale = await post(submit(staleKey, "+919876543247", centreId, { requestedCatalogueItemId: catalogueItemId, requestedCatalogueVersion: 4 }));
    expect(stale.status).toBe(400);
    expect(await stale.json()).toEqual({ error: "catalogue_selection_unavailable" });
    expect((await pool.query("SELECT id FROM public_enquiries WHERE organization_id=$1 AND idempotency_key=$2", [organizationId, staleKey])).rows).toHaveLength(0);
  });

  it("stores multiple canonical service snapshots and a requested home fee in the encrypted staff-review payload", async () => {
    const items = [
      { id: randomUUID(), centreId, version: 2, serviceType: "TEST" as const, serviceCode: "SYN-TEST-02", displayName: "Synthetic Blood Panel", priceAmount: "250.00", currency: "INR" },
      { id: randomUUID(), centreId, version: 3, serviceType: "PACKAGE" as const, serviceCode: "SYN-PKG-03", displayName: "Synthetic Wellness Package", priceAmount: "900.00", currency: "INR" },
    ];
    mocks.getPublicCatalogueItem.mockImplementation(async (id: string) => items.find((item) => item.id === id) ?? null);
    const key = randomUUID();
    const submitted = await post(submit(key, "+919876543238", centreId, {
      requestKind: "BOOKING_REQUEST", category: "TEST", requestedCatalogueItems: items.map(({ id, version }) => ({ id, version })),
      preferredDate: "2027-02-02", visitType: "HOME_COLLECTION", requestedHomeCharge: "99",
      addressLine1: "10 Synthetic Road", city: "Synthetic City", state: "Test State", postalCode: "123456",
    }));
    expect(submitted.status).toBe(202);
    const { reference } = await submitted.json() as { reference: string };
    const listed = await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}`));
    const body = await listed.json() as { enquiries: Array<PublicEnquiryPayload & { reference: string }> };
    const enquiry = body.enquiries.find((entry) => entry.reference === reference);
    expect(enquiry?.requestedCatalogueItems).toMatchObject(items.map(({ id, version, serviceType, serviceCode, displayName, priceAmount, currency }) => ({ id, version, serviceType, serviceCode, displayName, priceAmount, currency })));
    expect(enquiry).toMatchObject({ requestedHomeChargeChoice: "99", requestedHomeChargeRupees: 99, visitType: "HOME_COLLECTION", preferredDate: "2027-02-02" });
    const [stored] = (await pool.query("SELECT private_data_ciphertext FROM public_enquiries WHERE enquiry_number=$1", [reference])).rows;
    expect(stored.private_data_ciphertext).not.toContain("Synthetic Blood Panel");
    expect(stored.private_data_ciphertext).not.toContain("10 Synthetic Road");
  });

  it("encrypts public intake, replays idempotently, converts transactionally, and leaves contact permission pending", async () => {
    const { encryptOperationalData, operationalContext } = await import("@/server/operational-crypto");
    const campaignId = randomUUID();
    const campaignCiphertext = encryptOperationalData({ name: "Synthetic winter campaign", description: null }, operationalContext({ organizationId, centreId, recordId: campaignId }, "marketing-campaign"));
    await pool.query("INSERT INTO marketing_campaigns(id,organization_id,centre_id,campaign_code,channel,status,private_data_ciphertext,created_by_staff_id,updated_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,'SYNTHETIC-WINTER','WEBSITE','ACTIVE',$4,$5,$5,$6,$7)", [campaignId, organizationId, centreId, campaignCiphertext, staffUserId, randomUUID(), "c".repeat(64)]);
    const key = randomUUID();
    const attribution = { source: "google-ads", medium: "cpc", campaign: "synthetic-winter" };
    const submitted = await post(submit(key, "+919876543210", centreId, { requestTopic: "CORPORATE", organizationName: "Synthetic Clinic Group", campaignAttribution: attribution }));
    expect(submitted.status).toBe(202);
    const initial = await submitted.json() as { reference: string };
    const replay = await post(submit(key, "+919876543210", centreId, { requestTopic: "CORPORATE", organizationName: "Synthetic Clinic Group", campaignAttribution: attribution }));
    expect(replay.status).toBe(202);
    expect(await replay.json()).toEqual(initial);
    const [stored] = (await pool.query("SELECT id,status,private_data_ciphertext,phone_blind_index,request_fingerprint FROM public_enquiries WHERE organization_id=$1 AND idempotency_key=$2", [organizationId, key])).rows;
    expect(stored).toMatchObject({ status: "PENDING_REVIEW" });
    expect(stored.private_data_ciphertext).not.toContain("Synthetic");
    expect(stored.private_data_ciphertext).not.toContain("Synthetic Clinic Group");
    expect(stored.phone_blind_index).toMatch(/^[a-f0-9]{64}$/);
    expect(stored.request_fingerprint).not.toContain("Synthetic");
    const storedPayload = decryptLeadValue<PublicEnquiryPayload>("private-data", stored.private_data_ciphertext, publicEnquiryContext({ organizationId, centreId, id: stored.id }));
    expect(storedPayload.campaignAttribution).toEqual(attribution);
    const legacyFingerprintPayload = Object.fromEntries(Object.entries(storedPayload).filter(([field]) => field !== "submittedAt"));
    await pool.query("UPDATE public_enquiries SET request_fingerprint=$1 WHERE id=$2", [legacyPublicEnquiryFingerprint(legacyFingerprintPayload), stored.id]);
    const legacyReplay = await post(submit(key, "+919876543210", centreId, { requestTopic: "CORPORATE", organizationName: "Synthetic Clinic Group", campaignAttribution: attribution }));
    expect(legacyReplay.status).toBe(202);
    expect(await legacyReplay.json()).toEqual(initial);
    const response = await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}`));
    const list = await response.json() as { enquiries: Array<{ id: string; phone: string; firstName: string; organizationName: string; requestTopic: string; responsePermission: boolean; version: number }> };
    expect(response.status).toBe(200);
    expect(list.enquiries[0]).toMatchObject({ phone: "+919876543210", firstName: "Synthetic", organizationName: "Synthetic Clinic Group", requestTopic: "CORPORATE", responsePermission: true, version: 1 });
    const converted = await patch(new Request("http://localhost/api/public/enquiries", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ id: list.enquiries[0].id, action: "CONVERT_TO_LEAD", expectedVersion: 1, assignedStaffId: staffUserId }) }));
    expect(converted.status).toBe(200);
    const outcome = await converted.json() as { leadId: string; status: string };
    expect(outcome.status).toBe("CONVERTED_TO_LEAD");
    const saved = await pool.query("SELECT status,reviewed_by_staff_id,resulting_lead_id FROM public_enquiries WHERE id=$1", [list.enquiries[0].id]);
    expect(saved.rows[0]).toMatchObject({ status: "CONVERTED_TO_LEAD", reviewed_by_staff_id: staffUserId, resulting_lead_id: outcome.leadId });
    const lead = await pool.query("SELECT source,status,contact_permission,marketing_consent,marketing_campaign_id FROM leads WHERE id=$1", [outcome.leadId]);
    expect(lead.rows[0]).toMatchObject({ source: "WEBSITE", status: "NEW", contact_permission: "PENDING", marketing_consent: "NOT_REQUESTED", marketing_campaign_id: campaignId });
    const [leadPrivate] = (await pool.query("SELECT payload_ciphertext FROM lead_private_data WHERE lead_id=$1", [outcome.leadId])).rows;
    expect(decryptLeadPrivateData(leadPrivate.payload_ciphertext, { organizationId, centreId, recordId: outcome.leadId }).campaign).toBe("utm_source=google-ads;utm_medium=cpc;utm_campaign=synthetic-winter");
    const [activity] = (await pool.query("SELECT private_payload_ciphertext FROM lead_activities WHERE lead_id=$1", [outcome.leadId])).rows;
    expect(activity.private_payload_ciphertext).not.toContain("CORPORATE");
    expect(activity.private_payload_ciphertext).not.toContain("Synthetic Clinic Group");
    const histories = await pool.query("SELECT event_type FROM public_enquiry_events WHERE enquiry_id=$1 ORDER BY recorded_at,id", [list.enquiries[0].id]);
    expect(histories.rows.map((row) => row.event_type)).toEqual(["SUBMITTED", "CONVERTED_TO_LEAD"]);
    await expect(pool.query("UPDATE public_enquiry_events SET event_type='DISMISSED' WHERE enquiry_id=$1", [list.enquiries[0].id])).rejects.toThrow(/append-only/);
  });

  it("prevents duplicate CRM promotion and retains a reasoned dismissal event", async () => {
    const duplicateSubmit = await post(submit(randomUUID()));
    const duplicateReference = (await duplicateSubmit.json() as { reference: string }).reference;
    const [duplicateIdentity] = (await pool.query("SELECT id FROM public_enquiries WHERE organization_id=$1 AND enquiry_number=$2", [organizationId, duplicateReference])).rows as Array<{ id: string }>;
    const duplicateList = await (await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}`))).json() as { enquiries: Array<{ id: string; version: number }> };
    const duplicate = duplicateList.enquiries.find((row) => row.id === duplicateIdentity.id)!;
    const duplicateResponse = await patch(new Request("http://localhost/api/public/enquiries", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ id: duplicate.id, action: "CONVERT_TO_LEAD", expectedVersion: duplicate.version, assignedStaffId: staffUserId }) }));
    expect(duplicateSubmit.status).toBe(202);
    expect(duplicateResponse.status).toBe(409);
    expect(await duplicateResponse.json()).toMatchObject({ error: "possible_duplicate_review_required" });
    const dismissed = await patch(new Request("http://localhost/api/public/enquiries", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ id: duplicate.id, action: "DISMISS", expectedVersion: duplicate.version, reason: "Duplicate needs manual CRM review" }) }));
    expect(dismissed.status).toBe(200);
    const row = await pool.query("SELECT status FROM public_enquiries WHERE id=$1", [duplicate.id]);
    expect(row.rows[0].status).toBe("DISMISSED");
    const history = await pool.query("SELECT event_type,private_data_ciphertext FROM public_enquiry_events WHERE enquiry_id=$1 AND event_type='DISMISSED'", [duplicate.id]);
    expect(history.rows).toHaveLength(1);
    expect(history.rows[0].private_data_ciphertext).not.toContain("Duplicate needs manual CRM review");
  });

  it("keeps visitor-supplied campaign labels out of verified campaign metrics when no active campaign matches", async () => {
    const submitted = await post(submit(randomUUID(), "+919876543286", centreId, { campaignAttribution: { source: "newsletter", campaign: "not-configured" } }));
    expect(submitted.status).toBe(202);
    const reference = (await submitted.json() as { reference: string }).reference;
    const [enquiry] = (await pool.query("SELECT id FROM public_enquiries WHERE organization_id=$1 AND enquiry_number=$2", [organizationId, reference])).rows;
    const converted = await patch(new Request("http://localhost/api/public/enquiries", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ id: enquiry.id, action: "CONVERT_TO_LEAD", expectedVersion: 1, assignedStaffId: staffUserId }) }));
    expect(converted.status).toBe(200);
    const { leadId } = await converted.json() as { leadId: string };
    const [lead] = (await pool.query("SELECT marketing_campaign_id FROM leads WHERE id=$1", [leadId])).rows;
    expect(lead.marketing_campaign_id).toBeNull();
    const [privateLead] = (await pool.query("SELECT payload_ciphertext FROM lead_private_data WHERE lead_id=$1", [leadId])).rows;
    expect(decryptLeadPrivateData(privateLead.payload_ciphertext, { organizationId, centreId, recordId: leadId }).campaign).toBe("utm_source=newsletter;utm_campaign=not-configured");
  });

  it("keeps a public service issue in staff review instead of converting it into a sales lead", async () => {
    const submitted = await post(submit(randomUUID(), "+919876543285", centreId, { category: "SUPPORT", message: "Synthetic service feedback for staff review.", responsePermission: true }));
    expect(submitted.status).toBe(202);
    const reference = (await submitted.json() as { reference: string }).reference;
    const listed = await (await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}`))).json() as { enquiries: Array<{ id: string; reference: string; category: string; version: number }> };
    const enquiry = listed.enquiries.find((row) => row.reference === reference)!;
    expect(enquiry.category).toBe("SUPPORT");
    const converted = await patch(new Request("http://localhost/api/public/enquiries", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ id: enquiry.id, action: "CONVERT_TO_LEAD", expectedVersion: enquiry.version, assignedStaffId: staffUserId }) }));
    expect(converted.status).toBe(409);
    expect(await converted.json()).toMatchObject({ error: "support_enquiry_requires_support_task" });
    expect((await pool.query("SELECT lead_id FROM lead_private_data WHERE organization_id=$1 AND centre_id=$2 AND phone_blind_index=$3", [organizationId, centreId, blindIndexLeadContact("phone", "+919876543285")])).rowCount).toBe(0);
    const [stillPending] = (await pool.query("SELECT status,version_number FROM public_enquiries WHERE id=$1", [enquiry.id])).rows;
    expect(stillPending).toMatchObject({ status: "PENDING_REVIEW", version_number: enquiry.version });
    const [stored] = (await pool.query("SELECT id,private_data_ciphertext FROM public_enquiries WHERE id=$1", [enquiry.id])).rows;
    const payload = decryptLeadValue<PublicEnquiryPayload>("private-data", stored.private_data_ciphertext, publicEnquiryContext({ organizationId, centreId, id: stored.id }));
    expect(payload).toMatchObject({ category: "SUPPORT", message: "Synthetic service feedback for staff review.", responsePermission: true });
  });

  it("converts a response-approved corporate enquiry into an inactive encrypted relationship profile", async () => {
    const response = await post(submit(randomUUID(), "+919876543298", centreId, { requestTopic: "CORPORATE", organizationName: "Synthetic Partner Group", responsePermission: true, message: "Please have Rudra review a possible employer relationship." }));
    expect(response.status).toBe(202);
    const reference = (await response.json() as { reference: string }).reference;
    const listed = await (await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}`))).json() as { enquiries: Array<{ id: string; version: number; requestTopic: string }> };
    const item = listed.enquiries.find((row) => row.requestTopic === "CORPORATE")!;
    const unauthorized = await patch(new Request("http://localhost/api/public/enquiries", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ id: item.id, action: "CONVERT_TO_RELATIONSHIP", expectedVersion: item.version }) }));
    expect(unauthorized.status).toBe(403);
    expect((await pool.query("SELECT id FROM business_relationships WHERE source_public_enquiry_id=$1", [item.id])).rows).toHaveLength(0);
    grants = [...grants, "corporate.manage"];
    const converted = await patch(new Request("http://localhost/api/public/enquiries", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ id: item.id, action: "CONVERT_TO_RELATIONSHIP", expectedVersion: item.version }) }));
    expect(converted.status).toBe(200);
    const outcome = await converted.json() as { status: string; relationshipId: string; relationshipNumber: string; relationshipType: string; active: boolean };
    expect(outcome).toMatchObject({ status: "CONVERTED_TO_RELATIONSHIP", relationshipType: "CORPORATE", active: false });
    const [relationship] = (await pool.query("SELECT id,status,category,private_data_ciphertext FROM business_relationships WHERE source_public_enquiry_id=$1", [item.id])).rows;
    expect(relationship).toMatchObject({ id: outcome.relationshipId, status: "INACTIVE", category: "ENQUIRY_PENDING" });
    expect(relationship.private_data_ciphertext).not.toContain("Synthetic Partner Group");
    expect(relationship.private_data_ciphertext).not.toContain("possible employer relationship");
    expect(openBusinessRelationship({ organizationId, centreId, id: relationship.id }, "CORPORATE", relationship.private_data_ciphertext)).toMatchObject({ name: "Synthetic Partner Group", agreementStatus: "NOT_RECORDED", primaryContactName: "Synthetic Enquirer", notes: null });
    const [enquiry] = (await pool.query("SELECT private_data_ciphertext FROM public_enquiries WHERE id=$1", [item.id])).rows;
    expect(enquiry.private_data_ciphertext).not.toContain("possible employer relationship");
    const history = await pool.query("SELECT event_type FROM public_enquiry_events WHERE enquiry_id=$1 ORDER BY recorded_at,id", [item.id]);
    expect(history.rows.map((row) => row.event_type)).toEqual(["SUBMITTED", "CONVERTED_TO_RELATIONSHIP"]);
    const replay = await patch(new Request("http://localhost/api/public/enquiries", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ id: item.id, action: "CONVERT_TO_RELATIONSHIP", expectedVersion: item.version }) }));
    expect(replay.status).toBe(409);
    expect((await pool.query("SELECT id FROM business_relationships WHERE source_public_enquiry_id=$1", [item.id])).rows).toHaveLength(1);
    const byReference = await pool.query("SELECT id FROM public_enquiries WHERE enquiry_number=$1", [reference]);
    expect(byReference.rows[0].id).toBe(item.id);
    grants = ["leads.read", "leads.create", "leads.update"];
  });

  it("routes a doctor enquiry into the scoped CRM lead workflow without granting contact consent", async () => {
    const response = await post(submit(randomUUID(), "+919876543276", centreId, { requestTopic: "DOCTOR", organizationName: "Synthetic Family Practice", responsePermission: false, message: "Please review published test information for our clinic." }));
    expect(response.status).toBe(202);
    const reference = (await response.json() as { reference: string }).reference;
    const listed = await (await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}`))).json() as { enquiries: Array<{ id: string; reference: string; requestTopic: string; responsePermission: boolean; version: number }> };
    const enquiry = listed.enquiries.find((row) => row.reference === reference)!;
    expect(enquiry).toMatchObject({ requestTopic: "DOCTOR", responsePermission: false, version: 1 });
    const converted = await patch(new Request("http://localhost/api/public/enquiries", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ id: enquiry.id, action: "CONVERT_TO_LEAD", expectedVersion: enquiry.version, assignedStaffId: staffUserId }) }));
    expect(converted.status).toBe(200);
    const { leadId } = await converted.json() as { leadId: string };
    const [lead] = (await pool.query("SELECT contact_permission,centre_id FROM leads WHERE id=$1", [leadId])).rows as Array<{ contact_permission: string; centre_id: string }>;
    expect(lead).toMatchObject({ contact_permission: "PENDING", centre_id: centreId });
    const detail = await getLead(new Request(`http://localhost/api/leads/${leadId}`), { params: Promise.resolve({ id: leadId }) });
    const detailBody = await detail.json() as { activity: Array<{ metadata: Record<string, unknown> }> };
    expect(detailBody.activity.find((entry) => entry.metadata.source === "PUBLIC_ENQUIRY")?.metadata.requestTopic).toBe("DOCTOR");
    expect((await pool.query("SELECT event_type FROM public_enquiry_events WHERE enquiry_id=$1 ORDER BY recorded_at,id", [enquiry.id])).rows.map((row) => row.event_type)).toEqual(["SUBMITTED", "CONVERTED_TO_LEAD"]);
  });

  it("requires scoped partner approval and keeps a converted partner enquiry inactive", async () => {
    const response = await post(submit(randomUUID(), "+919876543275", centreId, { requestTopic: "PARTNER", organizationName: "Synthetic Sample Logistics", responsePermission: true, message: "Please review a possible sample logistics relationship." }));
    expect(response.status).toBe(202);
    const reference = (await response.json() as { reference: string }).reference;
    const listed = await (await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}`))).json() as { enquiries: Array<{ id: string; reference: string; requestTopic: string; version: number }> };
    const enquiry = listed.enquiries.find((row) => row.reference === reference)!;
    const body = JSON.stringify({ id: enquiry.id, action: "CONVERT_TO_RELATIONSHIP", expectedVersion: enquiry.version });
    const unauthorized = await patch(new Request("http://localhost/api/public/enquiries", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body }));
    expect(unauthorized.status).toBe(403);
    expect((await pool.query("SELECT id FROM business_relationships WHERE source_public_enquiry_id=$1", [enquiry.id])).rows).toHaveLength(0);
    grants = [...grants, "partners.manage"];
    const authorized = await patch(new Request("http://localhost/api/public/enquiries", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body }));
    expect(authorized.status).toBe(200);
    expect(await authorized.json()).toMatchObject({ status: "CONVERTED_TO_RELATIONSHIP", relationshipType: "PARTNER", active: false });
    const [relationship] = (await pool.query("SELECT status,category FROM business_relationships WHERE source_public_enquiry_id=$1", [enquiry.id])).rows;
    expect(relationship).toMatchObject({ status: "INACTIVE", category: "ENQUIRY_PENDING" });
    expect((await pool.query("SELECT event_type FROM public_enquiry_events WHERE enquiry_id=$1 ORDER BY recorded_at,id", [enquiry.id])).rows.map((row) => row.event_type)).toEqual(["SUBMITTED", "CONVERTED_TO_RELATIONSHIP"]);
    grants = ["leads.read", "leads.create", "leads.update"];
  });

  it("carries a selected catalogue snapshot into the CRM booking history while restricting collection addresses", async () => {
    const key = randomUUID();
    const catalogueItemId = randomUUID();
    const secondCatalogueItemId = randomUUID();
    mocks.getPublicCatalogueItem.mockResolvedValueOnce({ id: catalogueItemId, centreId, centreName: "Synthetic web centre", serviceType: "TEST", serviceCode: "SYN-TEST-01", version: 3, displayName: "Synthetic complete blood count", specimenRequirements: null, preparationInstructions: null, priceAmount: "250.00", currency: "INR", effectiveFrom: "2026-01-01", effectiveUntil: null });
    mocks.getPublicCatalogueItem.mockResolvedValueOnce({ id: secondCatalogueItemId, centreId, centreName: "Synthetic web centre", serviceType: "PACKAGE", serviceCode: "SYN-PKG-02", version: 2, displayName: "Synthetic wellness package", specimenRequirements: null, preparationInstructions: null, priceAmount: "500.00", currency: "INR", effectiveFrom: "2026-01-01", effectiveUntil: null });
    const response = await post(submit(key, "+919876543219", centreId, { requestKind: "BOOKING_REQUEST", category: "HOME_COLLECTION", requestedCatalogueItems: [{ id: catalogueItemId, version: 3 }, { id: secondCatalogueItemId, version: 2 }], requestedHomeCharge: "0", preferredDate: "2027-01-20", preferredTimeWindow: "Morning", visitType: "HOME_COLLECTION", addressLine1: "123 Synthetic Road", addressLine2: "Unit 4", city: "Sample City", state: "Test State", postalCode: "400001" }));
    expect(response.status).toBe(202);
    const reference = (await response.json() as { reference: string }).reference;
    const [stored] = (await pool.query("SELECT id,private_data_ciphertext FROM public_enquiries WHERE enquiry_number=$1", [reference])).rows;
    expect(stored.private_data_ciphertext).not.toContain("123 Synthetic Road");
    const listedResponse = await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}`));
    const listed = await listedResponse.json() as { enquiries: Array<{ id: string; version: number; requestKind: string; preferredDate: string; visitType: string; collectionAddress: { line1: string }; requestedCatalogueItems: Array<{ id: string; version: number; displayName: string }>; requestedHomeChargeChoice: string; requestedHomeChargeRupees: number }> };
    const request = listed.enquiries.find((row) => row.id === stored.id)!;
    expect(request).toMatchObject({ requestKind: "BOOKING_REQUEST", preferredDate: "2027-01-20", visitType: "HOME_COLLECTION", collectionAddress: { line1: "123 Synthetic Road" }, requestedCatalogueItems: [{ id: catalogueItemId, version: 3, displayName: "Synthetic complete blood count" }, { id: secondCatalogueItemId, version: 2, displayName: "Synthetic wellness package" }], requestedHomeChargeChoice: "0", requestedHomeChargeRupees: 0 });
    const converted = await patch(new Request("http://localhost/api/public/enquiries", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ id: request.id, action: "CONVERT_TO_LEAD", expectedVersion: request.version, assignedStaffId: staffUserId }) }));
    expect(converted.status).toBe(200);
    const leadId = (await converted.json() as { leadId: string }).leadId;
    const [activity] = (await pool.query("SELECT private_payload_ciphertext FROM lead_activities WHERE lead_id=$1", [leadId])).rows;
    expect(activity.private_payload_ciphertext).not.toContain("123 Synthetic Road");
    expect(activity.private_payload_ciphertext).not.toContain(catalogueItemId);
    const lead = (await pool.query("SELECT payload_ciphertext FROM lead_private_data WHERE lead_id=$1", [leadId])).rows[0];
    expect(JSON.stringify(lead)).not.toContain("Synthetic complete blood count");
    const detail = await getLead(new Request("http://localhost/api/leads/" + leadId), { params: Promise.resolve({ id: leadId }) });
    expect(detail.status).toBe(200);
    const detailBody = await detail.json() as { activity: Array<{ metadata: Record<string, unknown> }> };
    const booking = detailBody.activity.find((entry) => entry.metadata.requestKind === "BOOKING_REQUEST");
    expect(booking?.metadata).toMatchObject({ requestedCatalogueItemId: catalogueItemId, requestedCatalogueVersion: 3, requestedCatalogueItems: [{ id: catalogueItemId, version: 3, displayName: "Synthetic complete blood count" }, { id: secondCatalogueItemId, version: 2, displayName: "Synthetic wellness package" }], requestedHomeChargeChoice: "0", requestedHomeChargeRupees: 0, preferredDate: "2027-01-20", preferredTimeWindow: "Morning", visitType: "HOME_COLLECTION" });
    expect(booking?.metadata).not.toHaveProperty("collectionAddress");
    expect((await pool.query("SELECT event_type FROM public_enquiry_events WHERE enquiry_id=$1 ORDER BY recorded_at,id", [request.id])).rows.map((row) => row.event_type)).toEqual(["SUBMITTED", "CONVERTED_TO_LEAD"]);
    grants = [...grants, "appointments.read"];
    const authorizedDetail = await getLead(new Request("http://localhost/api/leads/" + leadId), { params: Promise.resolve({ id: leadId }) });
    const authorizedBody = await authorizedDetail.json() as { activity: Array<{ metadata: Record<string, unknown> }> };
    expect(authorizedBody.activity.find((entry) => entry.metadata.requestKind === "BOOKING_REQUEST")?.metadata.collectionAddress).toMatchObject({ line1: "123 Synthetic Road", postalCode: "400001" });
  });

  it("requires lead update permission to dismiss and hides cross-centre records", async () => {
    const response = await post(submit(randomUUID(), "+919876543211"));
    expect(response.status).toBe(202);
    const items = await (await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}`))).json() as { enquiries: Array<{ id: string; version: number }> };
    grants = ["leads.read", "leads.create"];
    const deniedDismissal = await patch(new Request("http://localhost/api/public/enquiries", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ id: items.enquiries[0].id, action: "DISMISS", expectedVersion: items.enquiries[0].version, reason: "Should not be allowed" }) }));
    expect(deniedDismissal.status).toBe(403);
    grants = ["leads.read", "leads.create", "leads.update"];
    const crossCentre = await get(new Request(`http://localhost/api/public/enquiries?centreId=${randomUUID()}`));
    expect(crossCentre.status).toBe(403);
    const otherCentreId = randomUUID();
    await pool.query("INSERT INTO centres(id,organization_id,code,name) VALUES($1,$2,$3,$4)", [otherCentreId, organizationId, `WEB-X-${otherCentreId.slice(0, 6)}`, "Synthetic restricted centre"]);
    mocks.listPublicCatalogueCentres.mockResolvedValue([{ id: centreId, code: "SYN-CENTRE", name: "Synthetic public centre" }, { id: otherCentreId, code: `WEB-X-${otherCentreId.slice(0, 6)}`, name: "Synthetic restricted centre" }]);
    const otherCentreSubmit = await post(submit(randomUUID(), "+919876543212", otherCentreId));
    expect(otherCentreSubmit.status).toBe(202);
    const otherCentreBody = await otherCentreSubmit.json() as { reference: string };
    const otherCentreRow = await pool.query("SELECT id,version_number FROM public_enquiries WHERE enquiry_number=$1", [otherCentreBody.reference]);
    const crossCentreReview = await patch(new Request("http://localhost/api/public/enquiries", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ id: otherCentreRow.rows[0].id, action: "DISMISS", expectedVersion: otherCentreRow.rows[0].version_number, reason: "Cross-centre review attempt" }) }));
    expect(crossCentreReview.status).toBe(404);
    expect(await crossCentreReview.json()).toEqual({ error: "not_found" });
  });

  it("integrates a synthetic public request through CRM, appointment, field custody, branch dispatch and quarantined report storage", async () => {
    grants = ["leads.read", "leads.create", "leads.update", "leads.convert", "patients.create", "patients.read", "appointments.create", "appointments.read", "appointments.update", "workspace.read", "orders.create", "orders.confirm", "collections.assign", "catalogue.price.verify"];
    const catalogueItemId = randomUUID();
    const catalogueVersionId = randomUUID();
    const phone = `+919${String(Date.now()).slice(-9)}`;
    await pool.query("INSERT INTO diagnostic_catalogue_items(id,organization_id,centre_id,service_type,service_code,current_version,active,created_by_staff_id) VALUES($1,$2,$3,'TEST','SYN-E2E-CBC',1,true,$4)", [catalogueItemId, organizationId, centreId, staffUserId]);
    // The fixture remains isolated to this disposable schema. The test-only source reference
    // exercises the real verification API contract; it is not Metropolis evidence or approval.
    await pool.query("INSERT INTO diagnostic_catalogue_versions(id,organization_id,centre_id,catalogue_item_id,version_number,display_name,verification_status,source_type,price_amount,effective_from,created_by_staff_id) VALUES($1,$2,$3,$4,1,'Synthetic CBC','UNVERIFIED','SYNTHETIC_TEST',450.00,'2026-01-01',$5)", [catalogueVersionId, organizationId, centreId, catalogueItemId, staffUserId]);
    mocks.getPublicCatalogueItem.mockResolvedValue({ id: catalogueItemId, centreId, version: 1, serviceType: "TEST", serviceCode: "SYN-E2E-CBC", displayName: "Synthetic CBC", priceAmount: "450.00", currency: "INR" });

    const intakeKey = randomUUID();
    const publicRequest = submit(intakeKey, phone, centreId, {
      requestKind: "BOOKING_REQUEST", category: "HOME_COLLECTION", requestedService: "Browser supplied name is replaced",
      requestedCatalogueItems: [{ id: catalogueItemId, version: 1 }], preferredDate: "2099-02-02", preferredTimeWindow: "Morning",
      visitType: "HOME_COLLECTION", requestedHomeCharge: "99", addressLine1: "10 Synthetic Road", city: "Synthetic City",
      state: "Test State", postalCode: "123456",
    });
    const validation = publicEnquiryCreateSchema.safeParse(await publicRequest.clone().json());
    expect(validation.success, JSON.stringify(validation.success ? null : validation.error.issues)).toBe(true);
    const accepted = await post(publicRequest);
    expect(accepted.status, JSON.stringify(await accepted.clone().json())).toBe(202);
    const receipt = await accepted.json() as { receiptId: string; reference: string };

    const queue = await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}&enquiryId=${receipt.receiptId}`));
    expect(queue.status).toBe(200);
    const enquiry = (await queue.json() as { enquiries: Array<{ id: string; version: number; requestedCatalogueItems: Array<{ id: string; version: number; displayName: string; priceAmount: string | null }> }> }).enquiries[0]!;
    expect(enquiry.requestedCatalogueItems).toMatchObject([{ id: catalogueItemId, version: 1, displayName: "Synthetic CBC", priceAmount: "450.00" }]);

    const convertedToLead = await patch(new Request("http://localhost/api/public/enquiries", {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ id: enquiry.id, action: "CONVERT_TO_LEAD", expectedVersion: enquiry.version, assignedStaffId: staffUserId }),
    }));
    expect(convertedToLead.status).toBe(200);
    const { leadId } = await convertedToLead.json() as { leadId: string };

    const qualify = await updateLead(new Request(`http://localhost/api/leads/${leadId}`, {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ status: "QUALIFIED", statusReason: "Synthetic staff reviewed requested service and intake" }),
    }), { params: Promise.resolve({ id: leadId }) });
    expect(qualify.status).toBe(200);

    const patientPayload = { firstName: "Synthetic", lastName: "Enquirer", phone, dateOfBirth: "1990-01-01", centreId, consentStatus: "NOT_RECORDED" };
    const conversionRequest = () => new Request(`http://localhost/api/leads/${leadId}/convert`, {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ mode: "NEW", patient: patientPayload }),
    });
    const conversionResponse = await convertLead(conversionRequest(), { params: Promise.resolve({ id: leadId }) });
    expect(conversionResponse.status).toBe(200);
    const { conversion } = await conversionResponse.json() as { conversion: { patientId: string; id: string } };
    const replayedConversion = await convertLead(conversionRequest(), { params: Promise.resolve({ id: leadId }) });
    expect((await replayedConversion.json() as { conversion: { patientId: string; id: string } }).conversion).toMatchObject(conversion);
    expect((await pool.query("SELECT count(*)::int AS count FROM patients WHERE id=$1", [conversion.patientId])).rows[0].count).toBe(1);
    expect((await pool.query("SELECT count(*)::int AS count FROM lead_conversions WHERE lead_id=$1", [leadId])).rows[0].count).toBe(1);
    expect((await pool.query("SELECT consent_status FROM patients WHERE id=$1", [conversion.patientId])).rows[0].consent_status).toBe("NOT_RECORDED");

    grants = [...grants, "appointments.update"];
    const leadDetail = await getLead(new Request(`http://localhost/api/leads/${leadId}`), { params: Promise.resolve({ id: leadId }) });
    const leadBody = await leadDetail.json() as { activity: Array<{ metadata: Record<string, unknown> }> };
    const requestSnapshot = leadBody.activity.find((event) => event.metadata.requestKind === "BOOKING_REQUEST")?.metadata;
    expect(requestSnapshot).toMatchObject({ requestedCatalogueItems: [{ id: catalogueItemId, version: 1 }], requestedHomeChargeChoice: "99", requestedHomeChargeRupees: 99, visitType: "HOME_COLLECTION" });
    expect(requestSnapshot?.collectionAddress).toMatchObject({ line1: "10 Synthetic Road", postalCode: "123456" });

    const appointmentKey = randomUUID();
    const appointmentPayload = {
      centreId, patientId: conversion.patientId, leadId, source: "CRM_LEAD", visitType: "HOME_COLLECTION",
      scheduledLocal: "2099-02-02T10:00", durationMinutes: 30,
      services: [{ type: "TEST", name: "Synthetic CBC", reference: catalogueItemId }],
      homeCollection: { address: { line1: "10 Synthetic Road", city: "Synthetic City", state: "Test State", postalCode: "123456" }, preferredWindow: "Morning", chargeChoice: "99" },
    };
    const appointmentRequest = () => new Request("http://localhost/api/appointments", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": appointmentKey },
      body: JSON.stringify(appointmentPayload),
    });
    const appointmentResponse = await createAppointment(appointmentRequest());
    expect(appointmentResponse.status).toBe(201);
    const { appointment } = await appointmentResponse.json() as { appointment: { id: string; status: string } };
    expect(appointment.status).toBe("REQUESTED");
    expect((await createAppointment(appointmentRequest()).then((response) => response.json()) as { appointment: { id: string }; replayed: boolean }).appointment.id).toBe(appointment.id);
    expect((await pool.query("SELECT count(*)::int AS count FROM appointments WHERE patient_id=$1 AND lead_id=$2", [conversion.patientId, leadId])).rows[0].count).toBe(1);
    const deniedCentreRequest = await createAppointment(new Request("http://localhost/api/appointments", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ ...appointmentPayload, centreId: randomUUID() }),
    }));
    expect(deniedCentreRequest.status).toBe(403);
    const storedAppointment = await pool.query("SELECT status,home_charge_choice,home_charge_rupees,private_data_ciphertext FROM appointments WHERE id=$1", [appointment.id]);
    expect(storedAppointment.rows[0]).toMatchObject({ status: "REQUESTED", home_charge_choice: "99", home_charge_rupees: 99 });
    expect(storedAppointment.rows[0].private_data_ciphertext).not.toContain("10 Synthetic Road");

    const confirmAppointmentResponse = await updateAppointment(new Request(`http://localhost/api/appointments/${appointment.id}`, {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ status: "CONFIRMED", reason: "TEST ONLY — isolated appointment state transition", expectedUpdatedAt: (await pool.query("SELECT updated_at FROM appointments WHERE id=$1", [appointment.id])).rows[0].updated_at.toISOString() }),
    }), { params: Promise.resolve({ id: appointment.id }) });
    expect(confirmAppointmentResponse.status).toBe(200);
    expect((await confirmAppointmentResponse.json() as { appointment: { status: string } }).appointment.status).toBe("CONFIRMED");

    const priceReview = await verifyCatalogue(new Request(`http://localhost/api/catalogue/${catalogueItemId}/verify`, {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ versionId: catalogueVersionId, decision: "VERIFIED", sourceReference: `TEST ONLY — synthetic fixture ${catalogueVersionId.slice(0, 8)}`, effectiveFrom: "2026-01-01", reason: "TEST ONLY — exercise current authorized price verification contract" }),
    }), { params: Promise.resolve({ id: catalogueItemId }) });
    expect(priceReview.status).toBe(200);

    const orderKey = randomUUID();
    const orderRequest = () => new Request("http://localhost/api/orders", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": orderKey },
      body: JSON.stringify({ centreId, patientId: conversion.patientId, appointmentId: appointment.id, catalogueVersionIds: [catalogueVersionId] }),
    });
    const orderResponse = await createOrder(orderRequest());
    expect(orderResponse.status).toBe(201);
    const { order } = await orderResponse.json() as { order: { id: string; status: string } };
    expect(order.status).toBe("DRAFT");
    expect((await createOrder(orderRequest()).then((response) => response.json()) as { order: { id: string } }).order.id).toBe(order.id);
    expect((await pool.query("SELECT count(*)::int AS count FROM diagnostic_orders WHERE idempotency_key=$1", [orderKey])).rows[0].count).toBe(1);
    const orderRow = await pool.query("SELECT status,total_amount FROM diagnostic_orders WHERE id=$1", [order.id]);
    expect(orderRow.rows[0]).toEqual({ status: "DRAFT", total_amount: null });

    const confirmOrder = await updateOrder(new Request(`http://localhost/api/orders/${order.id}`, {
      method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" },
      body: JSON.stringify({ action: "confirm", expectedVersion: 1 }),
    }), { params: Promise.resolve({ id: order.id }) });
    expect(confirmOrder.status).toBe(200);
    expect(await confirmOrder.json()).toMatchObject({ order: { status: "CONFIRMED", totalAmount: "450.00" } });

    const collectionResponse = await createCollectionJob(new Request("http://localhost/api/collections", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ appointmentId: appointment.id, orderId: order.id }),
    }));
    expect(collectionResponse.status).toBe(201);
    const { job } = await collectionResponse.json() as { job: { id: string } };
    expect((await createCollectionJob(new Request("http://localhost/api/collections", {
      method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ appointmentId: appointment.id, orderId: order.id }),
    }))).status).toBe(200);
    expect((await pool.query("SELECT count(*)::int AS count FROM collection_jobs WHERE order_id=$1", [order.id])).rows[0].count).toBe(1);

    // The following records and staff grants exist only in this disposable integration schema.
    // These procedure references are synthetic test fixtures, not operational SOP approvals.
    const collectorId = randomUUID(), collectorAuthId = randomUUID(), collectorRoleId = randomUUID();
    const collectorEmail = `${randomUUID().slice(0, 8)}@invalid.test`;
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [collectorAuthId, "Synthetic Collector", collectorEmail]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status) VALUES($1,$2,$3,$4,$5,'ACTIVE')", [collectorId, collectorAuthId, organizationId, `COL-${collectorId.slice(0, 8)}`, "Synthetic Collector"]);
    await pool.query("INSERT INTO roles(id,organization_id,key,name,scope) VALUES($1,$2,$3,$4,'CENTRE')", [collectorRoleId, organizationId, `collector_${collectorId.slice(0, 8)}`, "Synthetic collector"]);
    await pool.query("INSERT INTO permissions(key,description,scope) VALUES('collections.visit.record','TEST ONLY synthetic collection visit','CENTRE') ON CONFLICT(key) DO NOTHING");
    await pool.query("INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key='collections.visit.record' ON CONFLICT DO NOTHING", [collectorRoleId]);
    await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, collectorId, collectorRoleId, centreId]);
    const procedures = Object.fromEntries(["COLLECTION", "RECEIVING", "PACKING", "TRANSPORT"].map((operation) => [operation, randomUUID()]));
    for (const operation of Object.keys(procedures)) await pool.query("INSERT INTO sample_procedure_approvals(id,organization_id,centre_id,operation,reference,status,approved_by_staff_id) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6)", [procedures[operation as keyof typeof procedures], organizationId, centreId, operation, `TEST ONLY — synthetic ${operation} fixture`, staffUserId]);

    const collectionPath = `http://localhost/api/collections/${job.id}`;
    const collectionPatch = (action: string, expectedVersion: number, reason: string) => new Request(collectionPath, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action, expectedVersion, staffUserId: action === "assign" ? collectorId : undefined, reason, evidenceReference: action === "arrive" ? "TEST ONLY synthetic arrival marker" : undefined }) });
    const unauthorizedAssignment = await updateCollectionJob(new Request(collectionPath, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "assign", expectedVersion: 1, staffUserId: randomUUID(), reason: "TEST ONLY unauthorized synthetic collector" }) }), { params: Promise.resolve({ id: job.id }) });
    expect(unauthorizedAssignment.status).toBe(400);
    expect(await unauthorizedAssignment.json()).toEqual({ error: "collector_not_authorized" });
    const assignResponse = await updateCollectionJob(collectionPatch("assign", 1, "TEST ONLY assign synthetic collector"), { params: Promise.resolve({ id: job.id }) });
    expect(assignResponse.status).toBe(200);
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentreId?: string) => {
      if (requestedCentreId && requestedCentreId !== centreId) return { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null };
      const collectorPermissions = ["collections.visit.record", "samples.collect"];
      if (!collectorPermissions.includes(permission)) return { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null };
      return { response: null, staff: { organizationId, staffUserId: collectorId, grants: collectorPermissions.map((key) => ({ key, centreId })) } };
    });
    const collectorStep = async (action: string, expectedVersion: number) => updateCollectionJob(collectionPatch(action, expectedVersion, `TEST ONLY synthetic ${action}`), { params: Promise.resolve({ id: job.id }) });
    expect((await collectorStep("accept", 2)).status).toBe(200);
    expect((await collectorStep("start", 3)).status).toBe(200);
    const noArrivalCollect = await sampleAction(new Request("http://localhost/api/samples", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "collect", jobId: job.id, specimenType: "Synthetic EDTA tube", requirementReference: "TEST ONLY synthetic CBC fixture", identityCheckConfirmed: true, procedureApprovalId: procedures.COLLECTION, reason: "TEST ONLY collection before arrival" }) }));
    expect(noArrivalCollect.status).toBe(409);
    expect(await noArrivalCollect.json()).toEqual({ error: "collection_arrival_required" });
    expect((await collectorStep("arrive", 3)).status).toBe(409);
    expect((await collectorStep("arrive", 4)).status).toBe(200);
    const collectKey = randomUUID();
    const collectRequest = () => new Request("http://localhost/api/samples", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": collectKey }, body: JSON.stringify({ action: "collect", jobId: job.id, specimenType: "Synthetic EDTA tube", requirementReference: "TEST ONLY synthetic CBC fixture", identityCheckConfirmed: true, procedureApprovalId: procedures.COLLECTION, reason: "TEST ONLY simulated sample collection" }) });
    const collectResponse = await sampleAction(collectRequest());
    expect(collectResponse.status).toBe(201);
    const { result: collected } = await collectResponse.json() as { result: { id: string; status: string; versionNumber: number } };
    expect(collected.status).toBe("COLLECTED");
    expect((await sampleAction(collectRequest()).then((response) => response.json()) as { result: { id: string; replayed: boolean } }).result).toMatchObject({ id: collected.id, replayed: true });
    const submitHandover = await sampleAction(new Request("http://localhost/api/samples", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "submit_for_receiving", specimenId: collected.id, expectedVersion: 1, reason: "TEST ONLY simulated field custody handover" }) }));
    expect(submitHandover.status).toBe(200);
    const branchPermissions = ["samples.receive", "samples.dispatch", "samples.read"];
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentreId?: string) => requestedCentreId && requestedCentreId !== centreId ? { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null } : branchPermissions.includes(permission) ? { response: null, staff: { organizationId, staffUserId, grants: branchPermissions.map((key) => ({ key, centreId })) } } : { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null });
    const receive = await sampleAction(new Request("http://localhost/api/samples", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "receive", specimenId: collected.id, expectedVersion: 2, procedureApprovalId: procedures.RECEIVING, reason: "TEST ONLY synthetic branch receipt" }) }));
    expect(receive.status).toBe(200);
    expect(await receive.json()).toMatchObject({ result: { status: "RECEIVED_AT_RUDRA", versionNumber: 3 } });
    const dispatchResponse = await createDispatchBatch(new Request("http://localhost/api/samples/dispatch", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ centreId, specimenIds: [collected.id], packingProcedureApprovalId: procedures.PACKING, reason: "TEST ONLY synthetic branch packing" }) }));
    expect(dispatchResponse.status).toBe(201);
    const { batch } = await dispatchResponse.json() as { batch: { id: string; status: string } };
    expect(batch.status).toBe("PREPARING");
    const dispatchHandover = await dispatchAction(new Request(`http://localhost/api/samples/dispatch/${batch.id}`, { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ action: "handover", batchId: batch.id, expectedVersion: 1, carrierReference: `TEST ONLY internal carrier ${batch.id.slice(0, 8)}`, procedureApprovalId: procedures.TRANSPORT, reason: "TEST ONLY simulated internal carrier handover" }) }), { params: Promise.resolve({ id: batch.id }) });
    expect(dispatchHandover.status).toBe(200);
    expect(await dispatchHandover.json()).toMatchObject({ result: { status: "DISPATCHED", versionNumber: 2 } });
    expect((await pool.query("SELECT status FROM specimens WHERE id=$1", [collected.id])).rows[0].status).toBe("DISPATCHED");
    expect((await pool.query("SELECT count(*)::int AS count FROM sample_external_receipts WHERE batch_id=$1", [batch.id])).rows[0].count).toBe(0);
    const custody = await pool.query("SELECT event_type FROM sample_custody_events WHERE specimen_id=$1 ORDER BY recorded_at,id", [collected.id]);
    expect(custody.rows.map((row) => row.event_type)).toEqual(["COLLECTED", "SUBMITTED_FOR_RECEIVING", "RECEIVED_AT_RUDRA", "PACKED", "DISPATCHED"]);
    const joinedAudit = await pool.query("SELECT action FROM audit_events WHERE organization_id=$1 AND centre_id=$2 AND entity_id IN ($3,$4,$5,$6,$7) ORDER BY recorded_at", [organizationId, centreId, appointment.id, order.id, job.id, collected.id, batch.id]);
    expect(joinedAudit.rows.map((row) => row.action)).toEqual(expect.arrayContaining(["appointment.created", "diagnostic_order.confirmed", "collection_job.created", "specimen.collected", "specimen.received", "dispatch_batch.created", "dispatch_batch.handed_over"]));

    // Join internal finance to this same order and appointment. These are recorded/reviewed
    // internal evidence states only; the flow does not represent a bank or provider settlement.
    const financePermissions = ["finance.read", "finance.charge.create", "finance.payment.record", "finance.payment.verify", "finance.reconcile"];
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentreId?: string) => requestedCentreId && requestedCentreId !== centreId ? { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null } : financePermissions.includes(permission) ? { response: null, staff: { organizationId, staffUserId, grants: financePermissions.map((key) => ({ key, centreId })) } } : { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null });
    const financePost = (body: Record<string, unknown>, idempotencyKey = randomUUID()) => postFinance(new Request("http://localhost/api/finance", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": idempotencyKey }, body: JSON.stringify(body) }));
    const createCharges = await financePost({ action: "create_order_charges", orderId: order.id, appointmentId: appointment.id });
    expect(createCharges.status).toBe(201);
    const duplicateCharges = await financePost({ action: "create_order_charges", orderId: order.id, appointmentId: appointment.id });
    expect(duplicateCharges.status).toBe(201);
    expect(await duplicateCharges.json()).toMatchObject({ result: { chargeIds: [] } });
    const chargeRows = await pool.query("SELECT id,charge_type,amount_minor::text AS amount_minor,snapshot FROM finance_charges WHERE (order_id=$1 OR appointment_id=$2) AND state='ACTIVE' ORDER BY charge_type", [order.id, appointment.id]);
    expect(chargeRows.rows.map((row) => ({ type: row.charge_type, amount: row.amount_minor }))).toEqual([{ type: "DIAGNOSTIC", amount: "45000" }, { type: "HOME_COLLECTION", amount: "9900" }]);
    expect(chargeRows.rows[0].snapshot).toMatchObject({ source: "confirmed_order_snapshot", currency: "INR", invoiceIssuer: "PENDING", legalInvoice: false, items: [{ catalogueItemId, catalogueVersionId, verificationStatus: "VERIFIED", priceAmount: "450.00", priceSourceReference: expect.stringContaining("TEST ONLY") }] });
    expect(chargeRows.rows[1].snapshot).toMatchObject({ source: "appointment_charge_snapshot", choice: "99", currency: "INR", invoiceIssuer: "PENDING", legalInvoice: false });
    const diagnosticChargeId = chargeRows.rows.find((row) => row.charge_type === "DIAGNOSTIC")!.id as string;
    const openedReconciliation = await financePost({ action: "open_reconciliation", centreId, openingCashMinor: 0 });
    expect(openedReconciliation.status).toBe(201);
    const { result: opened } = await openedReconciliation.json() as { result: { reconciliationId: string } };
    const recordedKey = randomUUID();
    const recordPartial = () => financePost({ action: "record_payment", chargeId: diagnosticChargeId, amountMinor: 20_000, method: "CASH", reference: "TEST ONLY synthetic partial evidence" }, recordedKey);
    const partialPayment = await recordPartial();
    expect(partialPayment.status).toBe(201);
    const { result: partial } = await partialPayment.json() as { result: { paymentId: string; replayed: boolean } };
    expect((await recordPartial().then((response) => response.json()) as { result: { paymentId: string; replayed: boolean } }).result).toMatchObject({ paymentId: partial.paymentId, replayed: true });
    expect((await financePost({ action: "payment_decision", paymentId: partial.paymentId, decision: "CONFIRMED", expectedVersion: 1, reason: "TEST ONLY reviewed internal cash evidence; no settlement assertion" })).status).toBe(201);
    const disputedPayment = await financePost({ action: "record_payment", chargeId: diagnosticChargeId, amountMinor: 1_000, method: "CASH", reference: "TEST ONLY synthetic disputed evidence" });
    const { result: disputed } = await disputedPayment.json() as { result: { paymentId: string } };
    expect(disputedPayment.status).toBe(201);
    expect((await financePost({ action: "payment_decision", paymentId: disputed.paymentId, decision: "DISPUTED", expectedVersion: 1, reason: "TEST ONLY disputed internal evidence" })).status).toBe(201);
    const financeView = await getFinance(new Request(`http://localhost/api/finance?centreId=${centreId}`));
    const financeBody = await financeView.json() as { charges: Array<{ id: string; amountMinor: string; paidMinor: string; disputed: boolean }>; summary: { disputedPayments: number } };
    const diagnosticBalance = financeBody.charges.find((row) => row.id === diagnosticChargeId)!;
    expect(diagnosticBalance).toMatchObject({ amountMinor: "45000", paidMinor: "20000", disputed: true });
    expect(BigInt(diagnosticBalance.amountMinor) - BigInt(diagnosticBalance.paidMinor)).toBe(BigInt(25_000));
    const allOrderCharges = financeBody.charges.filter((row) => chargeRows.rows.some((charge) => charge.id === row.id));
    expect(allOrderCharges.reduce((sum, row) => sum + BigInt(row.amountMinor), BigInt(0)) - BigInt(diagnosticBalance.paidMinor)).toBe(BigInt(34_900));
    expect(financeBody.summary.disputedPayments).toBeGreaterThanOrEqual(1);
    const closerAuthId = randomUUID(), closerId = randomUUID();
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [closerAuthId, "Synthetic Finance Closer", `${closerAuthId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status) VALUES($1,$2,$3,$4,$5,'ACTIVE')", [closerId, closerAuthId, organizationId, `FIN-${closerId.slice(0, 8)}`, "Synthetic Finance Closer"]);
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentreId?: string) => requestedCentreId && requestedCentreId !== centreId ? { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null } : permission === "finance.reconcile" ? { response: null, staff: { organizationId, staffUserId: closerId, grants: [{ key: permission, centreId }] } } : { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null });
    const closeReconciliation = await financePost({ action: "close_reconciliation", reconciliationId: opened.reconciliationId, expectedVersion: 1, countedCashMinor: 20_000, reason: "TEST ONLY synthetic internal cash count" });
    expect(closeReconciliation.status).toBe(201);
    expect(await closeReconciliation.json()).toMatchObject({ result: { status: "CLOSED", expectedCashMinor: "20000", varianceMinor: "0" } });
    const financeAudit = await pool.query("SELECT action FROM audit_events WHERE organization_id=$1 AND centre_id=$2 AND entity_id IN ($3,$4,$5,$6) ORDER BY recorded_at", [organizationId, centreId, order.id, partial.paymentId, disputed.paymentId, opened.reconciliationId]);
    expect(financeAudit.rows.map((row) => row.action)).toEqual(expect.arrayContaining(["finance.order_charges_created", "finance.payment_recorded", "finance.payment_confirmed", "finance.payment_disputed", "finance.reconciliation_opened", "finance.reconciliation_closed"]));

    // Exercise document upload/access through the real API with temporary private storage,
    // disposable encryption keys and no scanner configured. This must remain quarantined.
    const savedEnv = new Map<string, string | undefined>();
    const testKeyId = `w7_${randomUUID().slice(0, 8)}`;
    const testKey = randomBytes(32).toString("base64");
    const storageDir = await mkdtemp(path.join(tmpdir(), "rudra-wave7-report-"));
    for (const [key, value] of Object.entries({ RUDRA_FIELD_ENCRYPTION_KEYS: JSON.stringify({ [testKeyId]: testKey }), RUDRA_FIELD_ACTIVE_KEY_ID: testKeyId, REPORT_DOCUMENT_ENCRYPTION_KEYS: JSON.stringify({ [testKeyId]: testKey }), REPORT_DOCUMENT_ACTIVE_KEY_ID: testKeyId, REPORT_PRIVATE_STORAGE_DIR: storageDir, REPORT_CLAMAV_HOST: "", REPORT_CLAMAV_PORT: "3310" })) {
      savedEnv.set(key, process.env[key]); process.env[key] = value;
    }
    const reportPermissions = ["reports.register", "reports.read", "reports.document.upload", "orders.read", "patients.read"];
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentreId?: string) => requestedCentreId && requestedCentreId !== centreId ? { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null } : reportPermissions.includes(permission) ? { response: null, staff: { organizationId, staffUserId, grants: reportPermissions.map((key) => ({ key, centreId })) } } : { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null });
    try {
      const registeredReport = await registerReport(new Request("http://localhost/api/reports", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "register", centreId, orderId: order.id }) }));
      expect(registeredReport.status).toBe(201);
      const { report } = await registeredReport.json() as { report: { id: string; status: string } };
      expect(report.status).toBe("AWAITING_REPORT");
      const syntheticPdf = Buffer.from("%PDF-1.4\nSynthetic test-only report document.\n%%EOF\n");
      const pdf = new File([syntheticPdf], "synthetic.pdf", { type: "application/pdf" });
      const form = new FormData(); form.set("file", pdf);
      const upload = await uploadReportDocument(new Request(`http://localhost/api/reports/${report.id}/documents`, { method: "POST", headers: { origin: "http://localhost", "idempotency-key": randomUUID() }, body: form }), { params: Promise.resolve({ id: report.id }) });
      expect(upload.status).toBe(201);
      expect(await upload.json()).toMatchObject({ document: { scanStatus: "QUARANTINED", replayed: false } });
      const storedDocument = await pool.query("SELECT storage_key,scan_status,encryption_key_id FROM report_documents WHERE report_id=$1", [report.id]);
      expect(storedDocument.rows[0]).toMatchObject({ scan_status: "QUARANTINED", encryption_key_id: testKeyId });
      const { reportFilePath } = await import("@/server/report-storage");
      const ciphertext = await readFile(reportFilePath(storedDocument.rows[0].storage_key));
      expect(ciphertext.includes(Buffer.from("Synthetic test-only report document"))).toBe(false);
      mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentreId?: string) => permission === "reports.read" && requestedCentreId ? { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null } : reportPermissions.includes(permission) ? { response: null, staff: { organizationId, staffUserId, grants: reportPermissions.map((key) => ({ key, centreId })) } } : { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null });
      const wrongCentre = await readReportDocument(new Request(`http://localhost/api/reports/${report.id}/documents`), { params: Promise.resolve({ id: report.id }) });
      expect(wrongCentre.status).toBe(403);
      expect(await wrongCentre.json()).toEqual({ error: "forbidden" });
      mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentreId?: string) => reportPermissions.includes(permission) && (!requestedCentreId || requestedCentreId === centreId) ? { response: null, staff: { organizationId, staffUserId, grants: reportPermissions.map((key) => ({ key, centreId })) } } : { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null });
      const quarantinedRead = await readReportDocument(new Request(`http://localhost/api/reports/${report.id}/documents`), { params: Promise.resolve({ id: report.id }) });
      expect(quarantinedRead.status).toBe(423);
      expect((await pool.query("SELECT action FROM audit_events WHERE entity_id=$1", [report.id])).rows.map((row) => row.action)).toContain("report.document_uploaded");

      // A real logical backup/restore of the disposable migrated app schema,
      // encrypted private document bytes and a separately wrapped test-only key.
      const postgresTools = await resolvePostgresTools();
      expect(postgresTools).not.toBeNull();
      recoveryTempDir = await mkdtemp(path.join(tmpdir(), "rudra-wave9-recovery-"));
      await protectRecoveryDirectory(recoveryTempDir);
      recoverySchema = `p2_09a_restore_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
      const sourceDoc = storedDocument.rows[0];
      const sourceDocPath = reportFilePath(sourceDoc.storage_key);
      const sourceCiphertext = await readFile(sourceDocPath);
      expect(sourceCiphertext.subarray(0, 5).toString("utf8")).not.toBe("%PDF-");
      const backupPath = path.join(recoveryTempDir, "synthetic-database-backup.sql");
      const restorePath = path.join(recoveryTempDir, "synthetic-database-restore.sql");
      const backupSql = await backupSchema({ connectionString: testUrl, schema, backupPath, tools: postgresTools! });
      const backupSha256 = createHash("sha256").update(backupSql).digest("hex");
      expect(backupSha256).toMatch(/^[a-f0-9]{64}$/);

      const testOnlyKeyMaterial = {
        format: "rudra-encryption-key-backup-v1",
        keys: {
          REPORT_DOCUMENT_ACTIVE_KEY_ID: testKeyId,
          REPORT_DOCUMENT_ENCRYPTION_KEYS: JSON.stringify({ [testKeyId]: testKey }),
          RUDRA_FIELD_ACTIVE_KEY_ID: testKeyId,
          RUDRA_FIELD_ENCRYPTION_KEYS: JSON.stringify({ [testKeyId]: testKey }),
          RUDRA_BLIND_INDEX_KEY: Buffer.alloc(32, 23).toString("base64"),
        },
      };
      const recoveryPassphrase = randomBytes(32).toString("base64url");
      const encryptedKeyBackup = await encryptKeyBackup(testOnlyKeyMaterial, recoveryPassphrase);
      const recoveredKeys = await decryptKeyBackup(encryptedKeyBackup, recoveryPassphrase);
      expect(recoveredKeys.keys).toEqual(testOnlyKeyMaterial.keys);

      const restoreStorage = path.join(recoveryTempDir, "private-documents");
      await mkdir(restoreStorage, { recursive: true });
      const restoredDocumentPath = path.join(restoreStorage, path.basename(sourceDocPath));
      await copyFile(sourceDocPath, restoredDocumentPath);
      expect(await readFile(restoredDocumentPath)).toEqual(sourceCiphertext);
      const restoredSchema = await restoreSchema({ connectionString: testUrl, sourceSchema: schema, destinationSchema: recoverySchema, backupSql, restorePath, tools: postgresTools! });
      expect(restoredSchema.sourceSchemaReferencesRemapped).toBeGreaterThan(0);

      const originalDatabaseUrl = process.env.DATABASE_URL;
      const restoreUrl = new URL(testUrl);
      restoreUrl.searchParams.set("options", `-csearch_path=${recoverySchema},public`);
      const { closeDatabasePool } = await import("@/db/client");
      await closeDatabasePool();
      process.env.DATABASE_URL = restoreUrl.toString();
      process.env.REPORT_PRIVATE_STORAGE_DIR = restoreStorage;
      process.env.REPORT_DOCUMENT_ENCRYPTION_KEYS = recoveredKeys.keys.REPORT_DOCUMENT_ENCRYPTION_KEYS;
      process.env.REPORT_DOCUMENT_ACTIVE_KEY_ID = recoveredKeys.keys.REPORT_DOCUMENT_ACTIVE_KEY_ID;
      const restoredPool = new Pool({ connectionString: restoreUrl.toString(), max: 1 });
      try {
        const restoredLink = await restoredPool.query("SELECT r.id,r.order_id,d.storage_key,d.sha256,d.scan_status,d.encryption_key_id FROM diagnostic_reports r JOIN report_documents d ON d.report_id=r.id WHERE r.id=$1", [report.id]);
        expect(restoredLink.rows[0]).toMatchObject({ id: report.id, order_id: order.id, storage_key: sourceDoc.storage_key, sha256: createHash("sha256").update(syntheticPdf).digest("hex"), scan_status: "QUARANTINED", encryption_key_id: testKeyId });
        const { readReportPdf } = await import("@/server/report-storage");
        expect(await readReportPdf(sourceDoc.storage_key, recoveredKeys.keys.REPORT_DOCUMENT_ACTIVE_KEY_ID)).toEqual(syntheticPdf);
        expect((await restoredPool.query("SELECT count(*)::int AS count FROM report_events WHERE report_id=$1 AND event_type='DOCUMENT_UPLOADED'", [report.id])).rows[0].count).toBe(1);
        const recoveredRead = await readReportDocument(new Request(`http://localhost/api/reports/${report.id}/documents`), { params: Promise.resolve({ id: report.id }) });
        expect(recoveredRead.status).toBe(423);
        expect(await recoveredRead.json()).toEqual({ error: "report_access_revoked_or_unavailable" });
      } finally {
        await restoredPool.end();
        await closeDatabasePool();
        if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = originalDatabaseUrl;
      }
    } finally {
      for (const [key, value] of savedEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await rm(storageDir, { recursive: true, force: true });
    }
    const audit = await pool.query("SELECT action FROM audit_events WHERE organization_id=$1 AND centre_id=$2 AND entity_id IN ($3,$4,$5) ORDER BY recorded_at", [organizationId, centreId, leadId, conversion.patientId, appointment.id]);
    expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining(["lead.converted", "appointment.created"]));
  }, 120_000);
});
