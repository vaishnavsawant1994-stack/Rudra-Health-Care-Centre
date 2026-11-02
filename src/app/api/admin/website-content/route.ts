import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db/client";
import { appendAuditEvent } from "@/server/audit";
import { getApiAccess } from "@/server/access";
import { csrfRejected, isSameOriginRequest } from "@/server/csrf";
import { openWebsiteContent, openWebsiteContentEvent, parsePublicContentSlug, publicContentSchema, sealWebsiteContent, sealWebsiteContentEvent } from "@/server/website-content";

type PageRow = { id: string; slug: string; draft_ciphertext: string; published_ciphertext: string | null; draft_version: number; published_version: number | null; published_at: Date | null; updated_at: Date; review_status: "NOT_SUBMITTED" | "PENDING" | "APPROVED" | "CHANGES_REQUESTED"; review_version: number | null; review_submitted_by_staff_id: string | null; review_decided_by_staff_id: string | null; review_decided_at: Date | null };
const inputSchema = z.object({ slug: z.string().min(1).max(48), action: z.enum(["SAVE_DRAFT", "SUBMIT_REVIEW", "APPROVE_REVIEW", "REQUEST_CHANGES", "PUBLISH", "UNPUBLISH"]), content: publicContentSchema.optional(), expectedVersion: z.number().int().min(0), reason: z.string().trim().min(1).max(500).optional() }).strict();
function rows<T>(result: unknown) { return (result as { rows?: T[] } | null | undefined)?.rows ?? []; }
function iso(value: Date | string | null) {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) throw new Error("invalid_website_content_timestamp");
  return date.toISOString();
}
function serialize(row: PageRow, organizationId: string) {
  return { slug: row.slug, draft: openWebsiteContent(organizationId, row.id, row.draft_ciphertext), published: row.published_ciphertext ? openWebsiteContent(organizationId, row.id, row.published_ciphertext) : null, draftVersion: row.draft_version, publishedVersion: row.published_version, publishedAt: iso(row.published_at), reviewStatus: row.review_status, reviewVersion: row.review_version, reviewSubmittedByStaffId: row.review_submitted_by_staff_id, reviewDecidedByStaffId: row.review_decided_by_staff_id, reviewDecidedAt: iso(row.review_decided_at), updatedAt: iso(row.updated_at)! };
}

export async function GET(request: Request) {
  const access = await getApiAccess("website.content.manage");
  if (access.response) return access.response;
  try {
    const rawSlug = new URL(request.url).searchParams.get("slug");
    if (rawSlug !== null) {
      const slug = parsePublicContentSlug(rawSlug);
      if (!slug) return Response.json({ error: "unsupported_content_page" }, { status: 400 });
      const pageResult = await getDb().execute(sql`SELECT id FROM website_content_pages WHERE organization_id = ${access.staff.organizationId} AND slug = ${slug} LIMIT 1`);
      const pageId = rows<{ id: string }>(pageResult)[0]?.id;
      if (!pageId) return Response.json({ versions: [] });
      const history = await getDb().execute(sql`SELECT version_number, content_ciphertext, actor_staff_id, recorded_at FROM website_content_versions WHERE organization_id = ${access.staff.organizationId} AND page_id = ${pageId} ORDER BY version_number DESC LIMIT 50`);
      const events = await getDb().execute(sql`SELECT id, event_type, event_ciphertext, actor_staff_id, recorded_at FROM website_content_events WHERE organization_id = ${access.staff.organizationId} AND page_id = ${pageId} ORDER BY recorded_at DESC, id DESC LIMIT 100`);
      return Response.json({ versions: rows<{ version_number: number; content_ciphertext: string; actor_staff_id: string; recorded_at: Date | string }>(history).map((row) => ({ version: row.version_number, content: openWebsiteContent(access.staff.organizationId, pageId, row.content_ciphertext), actorStaffId: row.actor_staff_id, recordedAt: iso(row.recorded_at) })), events: rows<{ id: string; event_type: string; event_ciphertext: string; actor_staff_id: string; recorded_at: Date | string }>(events).map((row) => ({ ...openWebsiteContentEvent(access.staff.organizationId, row.id, row.event_ciphertext), eventType: row.event_type, actorStaffId: row.actor_staff_id, recordedAt: iso(row.recorded_at) })) });
    }
    const result = await getDb().execute(sql`SELECT id, slug, draft_ciphertext, published_ciphertext, draft_version, published_version, published_at, updated_at, review_status, review_version, review_submitted_by_staff_id, review_decided_by_staff_id, review_decided_at FROM website_content_pages WHERE organization_id = ${access.staff.organizationId} ORDER BY slug`);
    return Response.json({ pages: rows<PageRow>(result).map((row) => serialize(row, access.staff.organizationId)) });
  } catch (error) {
    console.error("website_content_read_failed", { errorType: error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : "UnknownError" });
    return Response.json({ error: "website_content_unavailable" }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  if (!isSameOriginRequest(request)) return csrfRejected();
  const manage = await getApiAccess("website.content.manage");
  if (manage.response) return manage.response;
  let raw: unknown;
  try { raw = await request.json(); } catch { return Response.json({ error: "invalid_request" }, { status: 400 }); }
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return Response.json({ error: "invalid_website_content" }, { status: 400 });
  const slug = parsePublicContentSlug(parsed.data.slug);
  if (!slug) return Response.json({ error: "unsupported_content_page" }, { status: 400 });
  if (parsed.data.action === "SAVE_DRAFT" && !parsed.data.content) return Response.json({ error: "content_required" }, { status: 400 });
  if (["APPROVE_REVIEW", "REQUEST_CHANGES"].includes(parsed.data.action) && !parsed.data.reason) return Response.json({ error: "review_reason_required" }, { status: 400 });
  if (parsed.data.action === "APPROVE_REVIEW" || parsed.data.action === "REQUEST_CHANGES") {
    const review = await getApiAccess("website.content.review");
    if (review.response) return review.response;
    if (review.staff.organizationId !== manage.staff.organizationId || review.staff.staffUserId !== manage.staff.staffUserId) return Response.json({ error: "forbidden" }, { status: 403 });
  }
  if (parsed.data.action === "PUBLISH" || parsed.data.action === "UNPUBLISH") {
    const publish = await getApiAccess("website.content.publish");
    if (publish.response) return publish.response;
    if (publish.staff.organizationId !== manage.staff.organizationId || publish.staff.staffUserId !== manage.staff.staffUserId) return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const orgId = manage.staff.organizationId;
  try {
    const result = await getDb().transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`${orgId}:website-content:${slug}`}, 0))`);
      const currentResult = await tx.execute(sql`SELECT id, slug, draft_ciphertext, published_ciphertext, draft_version, published_version, published_at, updated_at, review_status, review_version, review_submitted_by_staff_id, review_decided_by_staff_id, review_decided_at FROM website_content_pages WHERE organization_id = ${orgId} AND slug = ${slug} FOR UPDATE`);
      const current = rows<PageRow>(currentResult)[0];
      if ((current?.draft_version ?? 0) !== parsed.data.expectedVersion) throw new Error("version_conflict");
      const pageId = current?.id ?? randomUUID();
      let draftCiphertext = current?.draft_ciphertext ?? "";
      let publishedCiphertext = current?.published_ciphertext ?? null;
      let draftVersion = current?.draft_version ?? 0;
      let publishedVersion = current?.published_version ?? null;
      let publishedAt = current?.published_at ?? null;
      let reviewStatus = current?.review_status ?? "NOT_SUBMITTED";
      let reviewVersion = current?.review_version ?? null;
      let reviewSubmittedBy = current?.review_submitted_by_staff_id ?? null;
      let reviewDecidedBy = current?.review_decided_by_staff_id ?? null;
      let reviewDecidedAt = current?.review_decided_at ?? null;
      let eventType: "DRAFT_SAVED" | "PUBLISHED" | "UNPUBLISHED" | "REVIEW_SUBMITTED" | "REVIEW_APPROVED" | "REVIEW_CHANGES_REQUESTED";
      let draftAuthor: string | null = null;
      if (current && current.draft_version > 0) {
        const authorResult = await tx.execute(sql`SELECT actor_staff_id FROM website_content_versions WHERE organization_id = ${orgId} AND page_id = ${current.id} AND version_number = ${current.draft_version} LIMIT 1`);
        draftAuthor = rows<{ actor_staff_id: string }>(authorResult)[0]?.actor_staff_id ?? null;
      }
      const eventId = randomUUID();
      if (parsed.data.action === "SAVE_DRAFT") {
        draftVersion += 1;
        draftCiphertext = sealWebsiteContent(orgId, pageId, parsed.data.content!);
        reviewStatus = "NOT_SUBMITTED"; reviewVersion = null; reviewSubmittedBy = null; reviewDecidedBy = null; reviewDecidedAt = null;
        eventType = "DRAFT_SAVED";
      } else if (parsed.data.action === "SUBMIT_REVIEW") {
        if (!current?.draft_ciphertext || ((reviewStatus === "PENDING" || reviewStatus === "APPROVED") && reviewVersion === draftVersion)) throw new Error("review_not_available");
        reviewStatus = "PENDING"; reviewVersion = draftVersion; reviewSubmittedBy = manage.staff.staffUserId; reviewDecidedBy = null; reviewDecidedAt = null;
        eventType = "REVIEW_SUBMITTED";
      } else if (parsed.data.action === "APPROVE_REVIEW" || parsed.data.action === "REQUEST_CHANGES") {
        if (!current || reviewStatus !== "PENDING" || reviewVersion !== draftVersion) throw new Error("review_not_pending");
        if (!reviewSubmittedBy || reviewSubmittedBy === manage.staff.staffUserId || draftAuthor === manage.staff.staffUserId) throw new Error("independent_review_required");
        reviewStatus = parsed.data.action === "APPROVE_REVIEW" ? "APPROVED" : "CHANGES_REQUESTED";
        reviewDecidedBy = manage.staff.staffUserId; reviewDecidedAt = new Date();
        eventType = parsed.data.action === "APPROVE_REVIEW" ? "REVIEW_APPROVED" : "REVIEW_CHANGES_REQUESTED";
      } else if (parsed.data.action === "PUBLISH") {
        if (!draftCiphertext) throw new Error("draft_required");
        if (reviewStatus !== "APPROVED" || reviewVersion !== draftVersion) throw new Error("review_required");
        if (publishedVersion === draftVersion) throw new Error("already_published");
        publishedCiphertext = draftCiphertext;
        publishedVersion = draftVersion;
        publishedAt = new Date();
        eventType = "PUBLISHED";
      } else {
        if (!publishedCiphertext) throw new Error("not_published");
        publishedCiphertext = null; publishedVersion = null; publishedAt = null;
        eventType = "UNPUBLISHED";
      }
      const values = { draftCiphertext, publishedCiphertext, draftVersion, publishedVersion, publishedAt, reviewStatus, reviewVersion, reviewSubmittedBy, reviewDecidedBy, reviewDecidedAt, actor: manage.staff.staffUserId };
      const written = await tx.execute(current
        ? sql`UPDATE website_content_pages SET draft_ciphertext = ${values.draftCiphertext}, published_ciphertext = ${values.publishedCiphertext}, draft_version = ${values.draftVersion}, published_version = ${values.publishedVersion}, published_at = ${values.publishedAt}, review_status = ${values.reviewStatus}, review_version = ${values.reviewVersion}, review_submitted_by_staff_id = ${values.reviewSubmittedBy}, review_decided_by_staff_id = ${values.reviewDecidedBy}, review_decided_at = ${values.reviewDecidedAt}, updated_by_staff_id = ${values.actor}, updated_at = now() WHERE id = ${pageId} AND organization_id = ${orgId} AND draft_version = ${parsed.data.expectedVersion} RETURNING id, slug, draft_ciphertext, published_ciphertext, draft_version, published_version, published_at, updated_at, review_status, review_version, review_submitted_by_staff_id, review_decided_by_staff_id, review_decided_at`
        : sql`INSERT INTO website_content_pages (id, organization_id, slug, draft_ciphertext, published_ciphertext, draft_version, published_version, published_at, review_status, review_version, review_submitted_by_staff_id, review_decided_by_staff_id, review_decided_at, created_by_staff_id, updated_by_staff_id) VALUES (${pageId}, ${orgId}, ${slug}, ${values.draftCiphertext}, ${values.publishedCiphertext}, ${values.draftVersion}, ${values.publishedVersion}, ${values.publishedAt}, ${values.reviewStatus}, ${values.reviewVersion}, ${values.reviewSubmittedBy}, ${values.reviewDecidedBy}, ${values.reviewDecidedAt}, ${values.actor}, ${values.actor}) RETURNING id, slug, draft_ciphertext, published_ciphertext, draft_version, published_version, published_at, updated_at, review_status, review_version, review_submitted_by_staff_id, review_decided_by_staff_id, review_decided_at`);
      const updated = rows<PageRow>(written)[0];
      if (!updated) throw new Error("version_conflict");
      if (eventType === "DRAFT_SAVED") await tx.execute(sql`INSERT INTO website_content_versions (organization_id, page_id, version_number, content_ciphertext, actor_staff_id) VALUES (${orgId}, ${pageId}, ${draftVersion}, ${draftCiphertext}, ${manage.staff.staffUserId})`);
      await tx.execute(sql`INSERT INTO website_content_events (id, organization_id, page_id, event_type, event_ciphertext, actor_staff_id) VALUES (${eventId}, ${orgId}, ${pageId}, ${eventType}, ${sealWebsiteContentEvent(orgId, eventId, { slug, version: draftVersion, publishedVersion, action: parsed.data.action, ...(parsed.data.reason ? { reason: parsed.data.reason } : {}) })}, ${manage.staff.staffUserId})`);
      await appendAuditEvent(tx, { organizationId: orgId, centreId: null, actorStaffId: manage.staff.staffUserId, action: `website_content.${eventType.toLowerCase()}`, entityType: "website_content_page", entityId: pageId, details: { slug, version: draftVersion, publishedVersion, reviewStatus } });
      return updated;
    });
    return Response.json({ page: serialize(result, orgId) });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const expectedConflict = ["version_conflict", "draft_required", "not_published", "already_published", "review_required", "review_not_available", "review_not_pending", "independent_review_required"].includes(code);
    const postgres = error && typeof error === "object" ? error as { code?: unknown; constraint?: unknown } : {};
    if (!expectedConflict) console.error("website_content_update_failed", { action: parsed.data.action, errorType: error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : "UnknownError", postgresCode: typeof postgres.code === "string" && /^[A-Z0-9]{5}$/.test(postgres.code) ? postgres.code : undefined, constraint: typeof postgres.constraint === "string" && /^[a-z0-9_]{1,80}$/.test(postgres.constraint) ? postgres.constraint : undefined });
    if (code === "version_conflict") return Response.json({ error: code }, { status: 409 });
    if (["draft_required", "not_published", "already_published", "review_required", "review_not_available", "review_not_pending", "independent_review_required"].includes(code)) return Response.json({ error: code }, { status: 409 });
    return Response.json({ error: "website_content_update_failed" }, { status: 500 });
  }
}
