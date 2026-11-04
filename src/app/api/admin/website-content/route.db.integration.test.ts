import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";
import { openWebsiteContent } from "@/server/website-content";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("website content review PostgreSQL lifecycle", () => {
  const { Pool } = pg;
  const schema = `p2_09a_website_review_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool>;
  let dropPool: InstanceType<typeof Pool> | undefined;
  let putHandler: typeof import("./route").PUT;
  let getHandler: typeof import("./route").GET;
  let publicGetHandler: typeof import("../../public/content/[slug]/route").GET;
  let organizationId: string;
  let editorId: string;
  let reviewerId: string;
  let ownerId: string;
  let activeStaffId = "";

  beforeAll(async () => {
    loadProjectEnvironment();
    testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) throw new Error("A dedicated PostgreSQL test database is required.");
    const admin = new Pool({ connectionString: testUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    await runMigrations(testUrl, null, schema);
    const scopedUrl = new URL(testUrl); scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`); process.env.DATABASE_URL = scopedUrl.toString();
    pool = new Pool({ connectionString: scopedUrl.toString(), max: 2 });
    organizationId = randomUUID(); editorId = randomUUID(); reviewerId = randomUUID(); ownerId = randomUUID();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `WR-${organizationId.slice(0, 8)}`, "Synthetic website review"]);
    for (const [staffId, label, isOwner] of [[editorId, "Editor", false], [reviewerId, "Reviewer", false], [ownerId, "Publisher", true]] as const) {
      const authId = randomUUID();
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authId, `Synthetic ${label}`, `${authId}@invalid.test`]);
      await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6)", [staffId, authId, organizationId, `ST-${staffId.slice(0, 8)}`, `Synthetic ${label}`, isOwner]);
    }
    mocks.getApiAccess.mockImplementation(async (permission: string) => {
      if (permission === "website.content.review" && activeStaffId === editorId) return { response: Response.json({ error: "forbidden" }, { status: 403 }) };
      if (permission === "website.content.publish" && activeStaffId !== ownerId) return { response: Response.json({ error: "forbidden" }, { status: 403 }) };
      return { staff: { organizationId, staffUserId: activeStaffId, grants: [{ key: "website.content.manage", centreId: null }, ...(activeStaffId === ownerId ? [{ key: "website.content.publish", centreId: null }] : []), ...(activeStaffId !== editorId ? [{ key: "website.content.review", centreId: null }] : [])] }, response: null };
    });
    ({ PUT: putHandler, GET: getHandler } = await import("./route"));
    ({ GET: publicGetHandler } = await import("../../public/content/[slug]/route"));
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ }
    await pool?.end();
    if (testUrl) { dropPool = new Pool({ connectionString: testUrl, max: 1 }); await dropPool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await dropPool.end(); }
    if (testUrl) process.env.DATABASE_URL = testUrl;
  }, 30_000);

  it("requires independent version review before owner publication and invalidates stale review", async () => {
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ website_review_test: randomBytes(32).toString("base64") });
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "website_review_test";
    const makeContent = (body: string) => ({ title: "Synthetic contact", summary: "Synthetic public information", sections: [{ heading: "Contact", body }] });
    const request = (action: string, expectedVersion: number, actor: string, content?: ReturnType<typeof makeContent>, reason?: string) => {
      activeStaffId = actor;
      return putHandler(new Request("http://localhost/api/admin/website-content", { method: "PUT", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ slug: "contact", action, expectedVersion, ...(content ? { content } : {}), ...(reason ? { reason } : {}) }) }));
    };
    const save = await request("SAVE_DRAFT", 0, editorId, makeContent("Synthetic contact details."));
    expect(save.status).toBe(200);
    const publishEarly = await request("PUBLISH", 1, ownerId);
    expect(publishEarly.status).toBe(409); expect(await publishEarly.json()).toMatchObject({ error: "review_required" });
    const submitted = await request("SUBMIT_REVIEW", 1, editorId);
    expect(submitted.status).toBe(200); expect(await submitted.json()).toMatchObject({ page: { reviewStatus: "PENDING", reviewVersion: 1 } });
    const selfReview = await request("APPROVE_REVIEW", 1, editorId, undefined, "Synthetic approval");
    expect(selfReview.status).toBe(403);
    const changesReason = "Synthetic requested edit";
    const changes = await request("REQUEST_CHANGES", 1, reviewerId, undefined, changesReason);
    expect(changes.status).toBe(200); expect(await changes.json()).toMatchObject({ page: { reviewStatus: "CHANGES_REQUESTED" } });
    const saveRevision = await request("SAVE_DRAFT", 1, editorId, makeContent("Revised synthetic contact details."));
    expect(saveRevision.status).toBe(200); expect(await saveRevision.json()).toMatchObject({ page: { draftVersion: 2, reviewStatus: "NOT_SUBMITTED", reviewVersion: null } });
    expect((await request("SUBMIT_REVIEW", 2, editorId)).status).toBe(200);
    const approved = await request("APPROVE_REVIEW", 2, reviewerId, undefined, "Synthetic editorial check complete");
    expect(approved.status).toBe(200); expect(await approved.json()).toMatchObject({ page: { reviewStatus: "APPROVED", reviewVersion: 2 } });
    expect((await request("SUBMIT_REVIEW", 2, editorId)).status).toBe(409);
    const publish = await request("PUBLISH", 2, ownerId);
    expect(publish.status).toBe(200); expect(await publish.json()).toMatchObject({ page: { publishedVersion: 2, reviewStatus: "APPROVED" } });
    const stored = await pool.query("SELECT id,draft_ciphertext,published_ciphertext FROM website_content_pages WHERE organization_id=$1 AND slug='contact'", [organizationId]);
    expect(stored.rows[0].draft_ciphertext).not.toContain("Revised synthetic contact details.");
    expect(openWebsiteContent(organizationId, stored.rows[0].id, stored.rows[0].published_ciphertext)).toEqual(makeContent("Revised synthetic contact details."));
    const newDraft = await request("SAVE_DRAFT", 2, editorId, makeContent("Another synthetic edit."));
    expect(newDraft.status).toBe(200); expect(await newDraft.json()).toMatchObject({ page: { reviewStatus: "NOT_SUBMITTED", publishedVersion: 2, draftVersion: 3 } });
    expect((await request("PUBLISH", 3, ownerId)).status).toBe(409);
    activeStaffId = editorId;
    const historyResponse = await getHandler(new Request("http://localhost/api/admin/website-content?slug=contact"));
    const history = await historyResponse.json() as { events: Array<{ eventType: string; reason?: string }> };
    expect(historyResponse.status, JSON.stringify(history)).toBe(200);
    expect(history.events.map((event) => event.eventType)).toEqual(expect.arrayContaining(["REVIEW_SUBMITTED", "REVIEW_CHANGES_REQUESTED", "REVIEW_APPROVED", "PUBLISHED"]));
    expect(history.events.find((event) => event.eventType === "REVIEW_CHANGES_REQUESTED")?.reason).toBe(changesReason);
    const eventRows = await pool.query("SELECT event_type,event_ciphertext FROM website_content_events WHERE organization_id=$1", [organizationId]);
    expect(eventRows.rows.find((row) => row.event_type === "REVIEW_CHANGES_REQUESTED").event_ciphertext).not.toContain(changesReason);
    const audit = await pool.query("SELECT action,details FROM audit_events WHERE organization_id=$1 AND entity_type='website_content_page' ORDER BY sequence", [organizationId]);
    expect(audit.rows.map((row) => row.action)).toEqual(expect.arrayContaining(["website_content.review_submitted", "website_content.review_approved", "website_content.review_changes_requested", "website_content.published"]));
    expect(JSON.stringify(audit.rows.map((row) => row.details))).not.toContain(changesReason);
    await expect(pool.query("UPDATE website_content_events SET event_type='DRAFT_SAVED' WHERE organization_id=$1", [organizationId])).rejects.toThrow();
  });

  it("publishes an allowlisted corporate information page through the public content API", async () => {
    const makeContent = (body: string) => ({ title: "Synthetic corporate services", summary: "Synthetic informational copy", sections: [{ heading: "Enquiries", body }] });
    const request = (action: string, expectedVersion: number, actor: string, content?: ReturnType<typeof makeContent>, reason?: string) => {
      activeStaffId = actor;
      return putHandler(new Request("http://localhost/api/admin/website-content", { method: "PUT", headers: { origin: "http://localhost", "content-type": "application/json" }, body: JSON.stringify({ slug: "corporate", action, expectedVersion, ...(content ? { content } : {}), ...(reason ? { reason } : {}) }) }));
    };
    expect((await request("SAVE_DRAFT", 0, editorId, makeContent("Contact Rudra for synthetic corporate enquiry details."))).status).toBe(200);
    expect((await request("SUBMIT_REVIEW", 1, editorId)).status).toBe(200);
    expect((await request("APPROVE_REVIEW", 1, reviewerId, undefined, "Synthetic editorial review" )).status).toBe(200);
    expect((await request("PUBLISH", 1, ownerId)).status).toBe(200);

    const stored = await pool.query("SELECT id,draft_ciphertext,published_ciphertext FROM website_content_pages WHERE organization_id=$1 AND slug='corporate'", [organizationId]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].draft_ciphertext).not.toContain("Contact Rudra");
    expect(openWebsiteContent(organizationId, stored.rows[0].id, stored.rows[0].published_ciphertext)).toEqual(makeContent("Contact Rudra for synthetic corporate enquiry details."));
    const publicResponse = await publicGetHandler(new Request("http://localhost/api/public/content/corporate"), { params: Promise.resolve({ slug: "corporate" }) });
    expect(publicResponse.status).toBe(200);
    expect(await publicResponse.json()).toMatchObject({ slug: "corporate", content: makeContent("Contact Rudra for synthetic corporate enquiry details.") });

    await expect(pool.query("INSERT INTO website_content_pages(organization_id,slug,draft_ciphertext,created_by_staff_id,updated_by_staff_id) VALUES($1,'privacy','ciphertext',$2,$2)", [organizationId, editorId])).rejects.toThrow();
  });
});
