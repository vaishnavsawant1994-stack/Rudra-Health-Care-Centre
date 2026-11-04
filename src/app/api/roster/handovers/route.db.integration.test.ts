import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";
import { encryptOperationalData, operationalContext } from "@/server/operational-crypto";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn(), staffUserId: "", taskRead: false }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("staff shift handover PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_handover_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool>;
  let post: typeof import("./route").POST;
  let get: typeof import("./route").GET;
  let patch: typeof import("./[id]/route").PATCH;
  let organizationId: string;
  let centreId: string;
  let outgoingStaffId: string;
  let incomingStaffId: string;
  let outsiderStaffId: string;
  let unprivilegedStaffId: string;
  let outgoingShiftId: string;
  let secondOutgoingShiftId: string;

  beforeAll(async () => {
    loadProjectEnvironment();
    testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) throw new Error("A dedicated test database is required.");
    const admin = new Pool({ connectionString: testUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    await runMigrations(testUrl, null, schema);
    const scopedUrl = new URL(testUrl); scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
    process.env.DATABASE_URL = scopedUrl.toString();
    pool = new Pool({ connectionString: scopedUrl.toString(), max: 1 });
    organizationId = randomUUID(); centreId = randomUUID(); outgoingStaffId = randomUUID(); incomingStaffId = randomUUID(); outsiderStaffId = randomUUID(); outgoingShiftId = randomUUID(); secondOutgoingShiftId = randomUUID();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `HO-${organizationId.slice(0, 8)}`, "Synthetic handover test"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name) VALUES($1,$2,$3,$4)", [centreId, organizationId, `HC-${centreId.slice(0, 8)}`, "Synthetic handover centre"]);
    const roleId = randomUUID();
    await pool.query("INSERT INTO roles(id,organization_id,key,name,scope) VALUES($1,$2,'handover_staff','Handover staff','CENTRE')", [roleId, organizationId]);
    const unprivilegedRoleId = randomUUID();
    await pool.query("INSERT INTO roles(id,organization_id,key,name,scope) VALUES($1,$2,'no_handover_staff','No handover permission','CENTRE')", [unprivilegedRoleId, organizationId]);
    let handoverPermission = await pool.query("SELECT id FROM permissions WHERE key='roster.handover' LIMIT 1");
    if (!handoverPermission.rows[0]) {
      await pool.query("INSERT INTO permissions(id,key,description,scope) VALUES($1,'roster.handover','Synthetic handover permission','CENTRE') ON CONFLICT (key) DO NOTHING", [randomUUID()]);
      handoverPermission = await pool.query("SELECT id FROM permissions WHERE key='roster.handover' LIMIT 1");
    }
    await pool.query("INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [roleId, handoverPermission.rows[0].id]);
    const taskReadPermission = await pool.query("SELECT id FROM permissions WHERE key='tasks.read' LIMIT 1");
    await pool.query("INSERT INTO role_permissions(role_id,permission_id) VALUES($1,$2) ON CONFLICT DO NOTHING", [roleId, taskReadPermission.rows[0].id]);
    unprivilegedStaffId = randomUUID();
    for (const [staffId, name, assignedRoleId] of [[outgoingStaffId, "Synthetic outgoing", roleId], [incomingStaffId, "Synthetic incoming", roleId], [outsiderStaffId, "Synthetic outsider", roleId], [unprivilegedStaffId, "Synthetic unprivileged", unprivilegedRoleId]] as const) {
      const authId = randomUUID();
      await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authId, name, `${authId}@invalid.test`]);
      await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status) VALUES($1,$2,$3,$4,$5,'ACTIVE')", [staffId, authId, organizationId, `HS-${staffId.slice(0, 8)}`, name]);
      await pool.query("INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id) VALUES($1,$2,$3,$4)", [organizationId, staffId, assignedRoleId, centreId]);
    }
    await pool.query("INSERT INTO staff_shifts(id,organization_id,centre_id,staff_id,shift_type,starts_at,ends_at,time_zone,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'SCHEDULED',now()-interval '1 hour',now()+interval '7 hours','Asia/Kolkata','synthetic-shift-cipher',$4,$5,$6)", [outgoingShiftId, organizationId, centreId, outgoingStaffId, randomUUID(), "a".repeat(64)]);
    await pool.query("INSERT INTO staff_shifts(id,organization_id,centre_id,staff_id,shift_type,starts_at,ends_at,time_zone,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'SCHEDULED',now()+interval '8 hours',now()+interval '16 hours','Asia/Kolkata','synthetic-shift-cipher',$4,$5,$6)", [secondOutgoingShiftId, organizationId, centreId, outgoingStaffId, randomUUID(), "b".repeat(64)]);
    mocks.staffUserId = outgoingStaffId;
    mocks.getApiAccess.mockImplementation(async () => ({ staff: { organizationId, staffUserId: mocks.staffUserId, grants: [{ key: "roster.handover", centreId }, ...(mocks.taskRead ? [{ key: "tasks.read", centreId }] : [])] }, response: null }));
    ({ GET: get, POST: post } = await import("./route"));
    ({ PATCH: patch } = await import("./[id]/route"));
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* already closed */ }
    await pool?.end();
    if (testUrl) { const admin = new Pool({ connectionString: testUrl, max: 1 }); await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await admin.end(); }
    if (testUrl) process.env.DATABASE_URL = testUrl;
  }, 60_000);

  const createRequest = (body: unknown, key = randomUUID()) => new Request("http://localhost/api/roster/handovers", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify(body) });

  it("prepares, replays, acknowledges and lists an encrypted handover with append-only history", async () => {
    const key = randomUUID();
    const payload = { centreId, outgoingShiftId, incomingStaffId, handoverNote: "Synthetic front desk tasks remain open for incoming shift." };
    const created = await post(createRequest(payload, key));
    expect(created.status).toBe(201);
    const createdBody = await created.json();
    const handoverId = createdBody.handover.id as string;
    const replay = await post(createRequest(payload, key));
    expect(replay.status).toBe(200);
    expect((await replay.json()).handover.id).toBe(handoverId);
    const mismatchedPrivateReplay = await post(createRequest({ ...payload, handoverNote: "Different synthetic private note." }, key));
    expect(mismatchedPrivateReplay.status).toBe(409);
    const stored = await pool.query("SELECT private_data_ciphertext FROM staff_shift_handovers WHERE id=$1", [handoverId]);
    expect(stored.rows[0].private_data_ciphertext).not.toContain(payload.handoverNote);
    mocks.staffUserId = incomingStaffId;
    const actionKey = randomUUID();
    const actionBody = JSON.stringify({ centreId, expectedVersion: 1, action: "ACKNOWLEDGE" });
    const actionRequest = () => new Request(`http://localhost/api/roster/handovers/${handoverId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": actionKey }, body: actionBody });
    const response = await patch(actionRequest(), { params: Promise.resolve({ id: handoverId }) });
    expect(response.status).toBe(200);
    expect((await response.json()).handover).toMatchObject({ status: "ACKNOWLEDGED", replayed: false });
    const replayedAction = await patch(actionRequest(), { params: Promise.resolve({ id: handoverId }) });
    expect(replayedAction.status).toBe(200);
    expect((await replayedAction.json()).handover).toMatchObject({ status: "ACKNOWLEDGED", replayed: true });
    const acknowledgmentEvents = await pool.query("SELECT count(*)::int AS count FROM staff_shift_handover_events WHERE handover_id=$1 AND event_type='ACKNOWLEDGED'", [handoverId]);
    expect(acknowledgmentEvents.rows[0].count).toBe(1);
    mocks.staffUserId = outsiderStaffId;
    const list = await get(new Request(`http://localhost/api/roster/handovers?centreId=${centreId}`));
    expect((await list.json()).handovers).toEqual([]);
    await pool.query("BEGIN");
    let eventUpdate = false;
    try { await pool.query("UPDATE staff_shift_handover_events SET event_type='PREPARED' WHERE handover_id=$1", [handoverId]); }
    catch { eventUpdate = true; }
    await pool.query("ROLLBACK");
    expect(eventUpdate).toBe(true);
  });

  it("rejects self handover and prevents an unrelated staff member from acknowledging", async () => {
    mocks.staffUserId = outgoingStaffId;
    const self = await post(createRequest({ centreId, outgoingShiftId, incomingStaffId: outgoingStaffId, handoverNote: "A note" }));
    expect(self.status).toBe(400);
    const created = await post(createRequest({ centreId, outgoingShiftId: secondOutgoingShiftId, incomingStaffId, handoverNote: "Another synthetic handover note." }));
    const handoverId = (await created.json()).handover.id as string;
    mocks.staffUserId = outsiderStaffId;
    const denied = await patch(new Request(`http://localhost/api/roster/handovers/${handoverId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ centreId, expectedVersion: 1, action: "ACKNOWLEDGE" }) }), { params: Promise.resolve({ id: handoverId }) });
    expect(denied.status).toBe(403);
  });

  it("checks cancellation reasons against the encrypted event on idempotent replay", async () => {
    mocks.staffUserId = outgoingStaffId;
    const cancellationShiftId = randomUUID();
    await pool.query("INSERT INTO staff_shifts(id,organization_id,centre_id,staff_id,shift_type,starts_at,ends_at,time_zone,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'SCHEDULED',now()+interval '40 hours',now()+interval '48 hours','Asia/Kolkata','synthetic-shift-cipher',$4,$5,$6)", [cancellationShiftId, organizationId, centreId, outgoingStaffId, randomUUID(), "e".repeat(64)]);
    const createKey = randomUUID();
    const created = await post(createRequest({ centreId, outgoingShiftId: cancellationShiftId, incomingStaffId, handoverNote: "Synthetic cancellation workflow." }, createKey));
    expect(created.status).toBe(201);
    const handoverId = (await created.json()).handover.id as string;
    const actionKey = randomUUID();
    const action = (reason: string) => patch(new Request(`http://localhost/api/roster/handovers/${handoverId}`, { method: "PATCH", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": actionKey }, body: JSON.stringify({ centreId, expectedVersion: 1, action: "CANCEL", reason }) }), { params: Promise.resolve({ id: handoverId }) });
    expect((await action("Synthetic cancellation reason A.")).status).toBe(200);
    expect((await action("Synthetic cancellation reason A.")).status).toBe(200);
    expect((await action("Synthetic cancellation reason B.")).status).toBe(409);
  });

  it("does not reveal an existing handover through an idempotent replay to an unrelated staff member", async () => {
    const key = randomUUID();
    const isolatedShiftId = randomUUID();
    await pool.query("INSERT INTO staff_shifts(id,organization_id,centre_id,staff_id,shift_type,starts_at,ends_at,time_zone,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'SCHEDULED',now()+interval '20 hours',now()+interval '28 hours','Asia/Kolkata','synthetic-shift-cipher',$4,$5,$6)", [isolatedShiftId, organizationId, centreId, outgoingStaffId, randomUUID(), "d".repeat(64)]);
    const payload = { centreId, outgoingShiftId: isolatedShiftId, incomingStaffId, handoverNote: "Synthetic private shift handover." };
    mocks.staffUserId = outgoingStaffId;
    const created = await post(createRequest(payload, key));
    expect(created.status).toBe(201);
    const createdId = ((await created.json()).handover.id) as string;

    mocks.staffUserId = outsiderStaffId;
    const replay = await post(createRequest(payload, key));
    expect(replay.status).toBe(403);
    expect(await replay.json()).toEqual({ error: "forbidden" });

    mocks.staffUserId = incomingStaffId;
    const participantReplay = await post(createRequest(payload, key));
    expect(participantReplay.status).toBe(200);
    expect((await participantReplay.json()).handover).toMatchObject({ id: createdId, replayed: true });
  });

  it("offers and accepts only incoming staff with the centre-scoped handover permission", async () => {
    mocks.staffUserId = outgoingStaffId;
    const listResponse = await get(new Request(`http://localhost/api/roster/handovers?centreId=${centreId}`));
    expect(listResponse.status).toBe(200);
    const listedStaff = (await listResponse.json()).incomingStaff as Array<{ id: string }>;
    expect(listedStaff.map((person) => person.id)).toContain(incomingStaffId);
    expect(listedStaff.map((person) => person.id)).not.toContain(unprivilegedStaffId);

    const response = await post(createRequest({ centreId, outgoingShiftId, incomingStaffId: unprivilegedStaffId, handoverNote: "Synthetic note for an ineligible recipient." }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "incoming_staff_unavailable" });
  });

  it("stores an encrypted centre-wide open-task snapshot and redacts it when current read permission is absent", async () => {
    mocks.staffUserId = outgoingStaffId;
    mocks.taskRead = true;
    const shiftId = randomUUID();
    await pool.query("INSERT INTO staff_shifts(id,organization_id,centre_id,staff_id,shift_type,starts_at,ends_at,time_zone,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'SCHEDULED',now()+interval '60 hours',now()+interval '68 hours','Asia/Kolkata','synthetic-shift-cipher',$4,$5,$6)", [shiftId, organizationId, centreId, outgoingStaffId, randomUUID(), "d".repeat(64)]);
    const taskId = randomUUID();
    const taskCiphertext = encryptOperationalData({ title: "Synthetic pending shift task", description: "Only encrypted test detail" }, operationalContext({ organizationId, centreId, recordId: taskId }, "staff-task"));
    await pool.query("INSERT INTO staff_tasks(id,organization_id,centre_id,task_number,private_data_ciphertext,task_type,priority,status,approval_status,assigned_staff_id,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'GENERAL','NORMAL','OPEN','NOT_REQUIRED',$6,$6,$7,$8)", [taskId, organizationId, centreId, `HT-${taskId.slice(0, 8)}`, taskCiphertext, outgoingStaffId, randomUUID(), "e".repeat(64)]);
    const key = randomUUID();
    const created = await post(createRequest({ centreId, outgoingShiftId: shiftId, incomingStaffId, handoverNote: "Synthetic open task remains for incoming staff." }, key));
    expect(created.status).toBe(201);
    const handoverId = (await created.json()).handover.id as string;
    const stored = await pool.query("SELECT private_data_ciphertext FROM staff_shift_handovers WHERE id=$1", [handoverId]);
    const privateData = (await import("@/server/operational-crypto")).decryptOperationalData<{ handoverNote: string; pendingWorkSnapshot: { capturedAt: string; categories: { tasks?: { count: number } } } }>(stored.rows[0].private_data_ciphertext, operationalContext({ organizationId, centreId, recordId: handoverId }, "staff-shift-handover"));
    expect(privateData.pendingWorkSnapshot.categories.tasks?.count).toBe(1);
    expect(stored.rows[0].private_data_ciphertext).not.toContain("Synthetic pending shift task");

    const visible = await get(new Request(`http://localhost/api/roster/handovers?centreId=${centreId}`));
    const visibleBody = await visible.json();
    expect(visibleBody.handovers.find((handover: { id: string }) => handover.id === handoverId).pendingWorkSnapshot.categories.tasks.count).toBe(1);
    mocks.taskRead = false;
    const redacted = await get(new Request(`http://localhost/api/roster/handovers?centreId=${centreId}`));
    const redactedBody = await redacted.json();
    expect(redactedBody.handovers.find((handover: { id: string }) => handover.id === handoverId).pendingWorkSnapshot).toBeNull();
  });

  it("paginates the complete authorized handover history without overlap", async () => {
    mocks.staffUserId = outgoingStaffId;
    await pool.query("TRUNCATE staff_shift_handovers CASCADE");
    const ids: string[] = [];
    for (let index = 0; index < 51; index += 1) {
      const id = randomUUID(); ids.push(id);
      const ciphertext = encryptOperationalData({ handoverNote: `Synthetic handover ${index}` }, operationalContext({ organizationId, centreId, recordId: id }, "staff-shift-handover"));
      await pool.query("INSERT INTO staff_shift_handovers(id,organization_id,centre_id,outgoing_shift_id,outgoing_staff_id,incoming_staff_id,status,private_data_ciphertext,idempotency_key,request_hash,created_by_staff_id,created_at) VALUES($1,$2,$3,$4,$5,$6,'CANCELLED',$7,$8,$9,$5,now()+make_interval(secs => $10))", [id, organizationId, centreId, outgoingShiftId, outgoingStaffId, incomingStaffId, ciphertext, randomUUID(), "c".repeat(64), index]);
    }
    const first = await get(new Request(`http://localhost/api/roster/handovers?centreId=${centreId}&page=1`));
    const firstBody = await first.json();
    const second = await get(new Request(`http://localhost/api/roster/handovers?centreId=${centreId}&page=2`));
    const secondBody = await second.json();
    expect(firstBody).toMatchObject({ page: 1, pageSize: 50, hasMore: true });
    expect(firstBody.handovers).toHaveLength(50);
    expect(secondBody).toMatchObject({ page: 2, pageSize: 50, hasMore: false });
    expect(secondBody.handovers).toHaveLength(1);
    const firstIds = (firstBody.handovers as Array<{ id: string }>).map((row) => row.id);
    const secondIds = (secondBody.handovers as Array<{ id: string }>).map((row) => row.id);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(51);
    expect(new Set([...firstIds, ...secondIds])).toEqual(new Set(ids));
    const invalid = await get(new Request(`http://localhost/api/roster/handovers?centreId=${centreId}&page=0`));
    expect(invalid.status).toBe(400);
  });
});
