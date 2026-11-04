import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("roster assignment history PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_roster_history_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool> | undefined;
  let handler: typeof import("./route").GET;
  let organizationId: string;
  let centreId: string;
  let otherCentreId: string;
  let managerId: string;
  let peerId: string;
  let accessMode: "MANAGER" | "ASSIGNED_ONLY" = "MANAGER";

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

    organizationId = randomUUID(); centreId = randomUUID(); otherCentreId = randomUUID(); managerId = randomUUID(); peerId = randomUUID();
    const managerAuthId = randomUUID(); const peerAuthId = randomUUID(); const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `RH-${seed}`, "Synthetic roster history test"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata'),($5,$2,$6,$7,'Asia/Kolkata')", [centreId, organizationId, `RH-${seed}`, "Synthetic history centre", otherCentreId, `RHX-${seed}`, "Synthetic other centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true),($4,$5,$6,true)', [managerAuthId, "Synthetic Roster Manager", `${seed.toLowerCase()}@manager.invalid.test`, peerAuthId, "Synthetic Field Staff", `${seed.toLowerCase()}@peer.invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false),($6,$7,$3,$8,$9,'ACTIVE',false)", [managerId, managerAuthId, organizationId, `RM-${seed}`, "Synthetic Roster Manager", peerId, peerAuthId, `RP-${seed}`, "Synthetic Field Staff"]);

    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentreId?: string) => {
      if (requestedCentreId !== centreId) return { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null };
      const base = { organizationId, staffUserId: managerId };
      if (permission === "roster.read") return { response: null, staff: { ...base, grants: [{ key: "roster.read", centreId }] } };
      if (accessMode === "MANAGER" && ["appointments.read", "collections.read"].includes(permission)) return { response: null, staff: { ...base, grants: [{ key: permission, centreId }] } };
      if (accessMode === "ASSIGNED_ONLY" && permission === "appointments.assigned.read") return { response: null, staff: { ...base, grants: [{ key: permission, centreId }] } };
      if (accessMode === "ASSIGNED_ONLY" && permission === "collections.visit.record") return { response: null, staff: { ...base, grants: [{ key: permission, centreId }] } };
      return { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null };
    });
    ({ GET: handler } = await import("./route"));
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* Pool may not have initialized. */ }
    await pool?.end();
    if (testUrl) {
      const admin = new Pool({ connectionString: testUrl, max: 1 });
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
      process.env.DATABASE_URL = testUrl;
    }
  }, 30_000);

  async function seedEvents() {
    const patientId = randomUUID(); const privatePatientNumber = `SYN-${randomUUID().slice(0, 16)}`;
    await pool!.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',$5)", [patientId, organizationId, centreId, privatePatientNumber, managerId]);
    const workAt = new Date("2026-11-05T10:00:00.000Z");
    const apptIds = [randomUUID(), randomUUID(), randomUUID()];
    const apptCentres = [centreId, centreId, otherCentreId];
    const apptNumbers = [`AP-${randomUUID().slice(0, 8)}`, `AP-${randomUUID().slice(0, 8)}`, `AP-OTHER-${randomUUID().slice(0, 8)}`];
    for (let index = 0; index < apptIds.length; index += 1) {
      const apptPatient = apptCentres[index] === centreId ? patientId : randomUUID();
      if (apptCentres[index] !== centreId) await pool!.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',$5)", [apptPatient, organizationId, otherCentreId, `OTH-${randomUUID().slice(0, 16)}`, managerId]);
      await pool!.query("INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,booking_source,visit_type,scheduled_at,duration_minutes,time_zone,status,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'STAFF','CENTRE',$6,30,'Asia/Kolkata','CONFIRMED','synthetic-ciphertext',$7,$8,$9)", [apptIds[index], organizationId, apptCentres[index], apptNumbers[index], apptPatient, workAt, managerId, randomUUID(), "a".repeat(64)]);
      const hiddenEvent = index === 1;
      await pool!.query("INSERT INTO appointment_assignment_history(id,organization_id,centre_id,appointment_id,action,staff_id,previous_staff_id,work_start,work_end,private_data_ciphertext,actor_staff_id,recorded_at) VALUES($1,$2,$3,$4,'REASSIGNED',$5,$6,$7,$8,'synthetic-private-reason',$9,$10)", [randomUUID(), organizationId, apptCentres[index], apptIds[index], hiddenEvent ? peerId : managerId, hiddenEvent ? null : peerId, workAt, new Date(workAt.getTime() + 30 * 60_000), hiddenEvent ? peerId : managerId, new Date(workAt.getTime() + index * 1000)]);
    }

    const jobIds = [randomUUID(), randomUUID()];
    for (let index = 0; index < jobIds.length; index += 1) {
      const jobId = jobIds[index]; const jobNumber = `CJ-${randomUUID().slice(0, 8)}`; const eventId = randomUUID(); const orderId = randomUUID(); const hiddenEvent = index === 1;
      await pool!.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [orderId, organizationId, centreId, `OR-${randomUUID().slice(0, 8)}`, patientId, apptIds[index], randomUUID(), "b".repeat(64), managerId]);
      await pool!.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,assigned_staff_id,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'ASSIGNED',$8,$9,$10,$11,$12)", [jobId, organizationId, centreId, jobNumber, apptIds[0], orderId, patientId, hiddenEvent ? peerId : managerId, workAt, new Date(workAt.getTime() + 30 * 60_000), randomUUID(), managerId]);
      await pool!.query("INSERT INTO collection_job_events(id,organization_id,centre_id,job_id,event_type,source,private_data_ciphertext,staff_id,previous_staff_id,actor_staff_id,recorded_at) VALUES($1,$2,$3,$4,'REASSIGNED','STAFF','synthetic-private-reason',$5,$6,$7,$8)", [eventId, organizationId, centreId, jobId, hiddenEvent ? peerId : managerId, hiddenEvent ? null : peerId, hiddenEvent ? peerId : managerId, new Date(workAt.getTime() + (index + 3) * 1000)]);
    }
    return { privatePatientNumber, apptNumbers, jobIds };
  }

  it("shows centre-scoped appointment and collection assignment history without patient or private-note fields", async () => {
    accessMode = "MANAGER";
    const seeded = await seedEvents();
    const response = await handler(new Request(`http://localhost/api/roster/assignment-history?centreId=${centreId}&from=2026-11-05T00%3A00%3A00.000Z&to=2026-11-06T00%3A00%3A00.000Z`));
    const body = await response.json() as { events: Array<Record<string, unknown>>; hasMore: boolean };
    expect(response.status).toBe(200);
    expect(body.events).toHaveLength(4);
    expect(body.events.map((event) => event.workType)).toEqual(expect.arrayContaining(["APPOINTMENT", "COLLECTION"]));
    expect(body.events.map((event) => event.workReference)).not.toContain(seeded.apptNumbers[2]);
    expect(JSON.stringify(body)).not.toContain(seeded.privatePatientNumber);
    expect(JSON.stringify(body)).not.toContain("synthetic-private-reason");
    expect(body.events.every((event) => !("privateDataCiphertext" in event) && !("patientId" in event))).toBe(true);

    const otherCentreResponse = await handler(new Request(`http://localhost/api/roster/assignment-history?centreId=${otherCentreId}&from=2026-11-05T00%3A00%3A00.000Z&to=2026-11-06T00%3A00%3A00.000Z`));
    expect(otherCentreResponse.status).toBe(403);
  }, 30_000);

  it("limits narrower appointment and field-visit grants to assignment events involving the caller", async () => {
    accessMode = "ASSIGNED_ONLY";
    await seedEvents();
    const response = await handler(new Request(`http://localhost/api/roster/assignment-history?centreId=${centreId}&from=2026-11-05T00%3A00%3A00.000Z&to=2026-11-06T00%3A00%3A00.000Z`));
    const body = await response.json() as { events: Array<Record<string, unknown>> };
    expect(response.status).toBe(200);
    expect(body.events).toHaveLength(4);
    expect(body.events.every((event) => event.actorName === "Synthetic Roster Manager")).toBe(true);
    expect(body.events.map((event) => event.workType)).toEqual(expect.arrayContaining(["APPOINTMENT", "COLLECTION"]));
  }, 30_000);

  it("rejects invalid ranges and pages before making authorization calls", async () => {
    mocks.getApiAccess.mockClear();
    const response = await handler(new Request(`http://localhost/api/roster/assignment-history?centreId=${centreId}&from=2026-11-05T00%3A00%3A00.000Z&to=2026-11-06T00%3A00%3A00.000Z&page=0`));
    expect(response.status).toBe(400);
    expect(mocks.getApiAccess).not.toHaveBeenCalled();
  });
});
