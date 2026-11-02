import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";
import { openBusinessRelationship } from "@/server/business-relationship-data";
import { encryptCentrePublicProfile } from "@/server/centre-public-profile";
import { blindIndexLeadContact, decryptLeadPrivateData, decryptLeadValue, encryptLeadValue } from "@/server/lead-crypto";
import { legacyPublicEnquiryFingerprint, publicEnquiryContext, type PublicEnquiryPayload } from "@/server/public-enquiry-policy";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), listPublicCatalogueCentres: vi.fn(), getPublicCatalogueItem: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));
vi.mock("@/server/public-catalogue", () => ({ listPublicCatalogueCentres: mocks.listPublicCatalogueCentres, getPublicCatalogueItem: mocks.getPublicCatalogueItem }));

describe("public enquiry PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_public_enquiry_${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  let pool: InstanceType<typeof Pool>;
  let dropPool: InstanceType<typeof Pool> | undefined;
  let post: typeof import("./route").POST;
  let get: typeof import("./route").GET;
  let patch: typeof import("./route").PATCH;
  let organizationId: string;
  let centreId: string;
  let staffUserId: string;
  let grants: string[];

  beforeAll(async () => {
    loadProjectEnvironment();
    const testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) throw new Error("A dedicated test database is required.");
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
    grants = ["leads.read", "leads.create", "leads.update"];
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentreId?: string) => {
      if (requestedCentreId && requestedCentreId !== centreId) return { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null };
      if (!grants.includes(permission)) return { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null };
      return { response: null, staff: { organizationId, staffUserId, grants: grants.map((key) => ({ key, centreId })) } };
    });
    mocks.listPublicCatalogueCentres.mockResolvedValue([{ id: centreId, code: `WEB-${seed}`, name: "Synthetic web centre" }]);
    ({ POST: post, GET: get, PATCH: patch } = await import("./route"));
  }, 30_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ }
    if (pool) await pool.end();
    if (dropPool) { await dropPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await dropPool.end(); }
    if (process.env.DATABASE_TEST_URL) process.env.DATABASE_URL = process.env.DATABASE_TEST_URL;
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
    const invalid = await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}&page=0`));
    expect(invalid.status).toBe(400);
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
    const receipt = await response.json() as { accepted: boolean; reference: string };
    expect(receipt.accepted).toBe(true);
    const stored = await pool.query("SELECT centre_id,status,private_data_ciphertext FROM public_enquiries WHERE organization_id=$1 AND idempotency_key=$2", [organizationId, key]);
    expect(stored.rows).toHaveLength(1);
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
    expect(accepted.status).toBe(202);
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

  it("keeps home-collection booking requests encrypted and converts them only to unconfirmed CRM follow-up", async () => {
    const key = randomUUID();
    const response = await post(submit(key, "+919876543219", centreId, { requestKind: "BOOKING_REQUEST", category: "HOME_COLLECTION", requestedService: "Synthetic test service", preferredDate: "2027-01-20", preferredTimeWindow: "Morning", visitType: "HOME_COLLECTION", addressLine1: "123 Synthetic Road", addressLine2: "Unit 4", city: "Sample City", state: "Test State", postalCode: "400001" }));
    expect(response.status).toBe(202);
    const reference = (await response.json() as { reference: string }).reference;
    const [stored] = (await pool.query("SELECT id,private_data_ciphertext FROM public_enquiries WHERE enquiry_number=$1", [reference])).rows;
    expect(stored.private_data_ciphertext).not.toContain("123 Synthetic Road");
    const listedResponse = await get(new Request(`http://localhost/api/public/enquiries?centreId=${centreId}`));
    const listed = await listedResponse.json() as { enquiries: Array<{ id: string; version: number; requestKind: string; preferredDate: string; visitType: string; collectionAddress: { line1: string } }> };
    const request = listed.enquiries.find((row) => row.id === stored.id)!;
    expect(request).toMatchObject({ requestKind: "BOOKING_REQUEST", preferredDate: "2027-01-20", visitType: "HOME_COLLECTION", collectionAddress: { line1: "123 Synthetic Road" } });
    const converted = await patch(new Request("http://localhost/api/public/enquiries", { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ id: request.id, action: "CONVERT_TO_LEAD", expectedVersion: request.version, assignedStaffId: staffUserId }) }));
    expect(converted.status).toBe(200);
    const leadId = (await converted.json() as { leadId: string }).leadId;
    const [activity] = (await pool.query("SELECT private_payload_ciphertext FROM lead_activities WHERE lead_id=$1", [leadId])).rows;
    expect(activity.private_payload_ciphertext).not.toContain("123 Synthetic Road");
    const lead = (await pool.query("SELECT payload_ciphertext FROM lead_private_data WHERE lead_id=$1", [leadId])).rows[0];
    expect(JSON.stringify(lead)).not.toContain("Synthetic test service");
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
});
