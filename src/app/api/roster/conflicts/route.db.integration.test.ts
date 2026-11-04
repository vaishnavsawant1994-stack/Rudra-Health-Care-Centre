import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../../scripts/migrate.mjs";
import { encryptOperationalData, operationalContext } from "@/server/operational-crypto";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("roster conflicts PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_roster_conflicts_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool> | undefined;
  let handler: typeof import("./route").GET;
  let organizationId: string;
  let centreId: string;
  let otherCentreId: string;
  let staffId: string;
  let peerId: string;
  let rosterMode: "TEAM" | "SELF_ONLY" = "TEAM";

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

    organizationId = randomUUID(); centreId = randomUUID(); otherCentreId = randomUUID(); staffId = randomUUID(); peerId = randomUUID();
    const authUserId = randomUUID(); const peerAuthUserId = randomUUID(); const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `RC-${seed}`, "Synthetic roster conflict test"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata'),($5,$2,$6,$7,'Asia/Kolkata')", [centreId, organizationId, `RC-${seed}`, "Synthetic conflict centre", otherCentreId, `RCX-${seed}`, "Synthetic other centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true),($4,$5,$6,true)', [authUserId, "Synthetic Roster Manager", `${seed.toLowerCase()}@invalid.test`, peerAuthUserId, "Synthetic Roster Peer", `${seed.toLowerCase()}-peer@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false),($6,$7,$3,$8,$9,'ACTIVE',false)", [staffId, authUserId, organizationId, `RC-${seed}`, "Synthetic Roster Manager", peerId, peerAuthUserId, `RP-${seed}`, "Synthetic Roster Peer"]);

    const teamGrants = [{ key: "roster.read", centreId }, { key: "roster.manage", centreId }, { key: "appointments.read", centreId }, { key: "collections.read", centreId }];
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentreId?: string) => {
      const grants = rosterMode === "TEAM" ? teamGrants : teamGrants.filter((grant) => grant.key !== "roster.manage");
      if (requestedCentreId === centreId && ["roster.read", "appointments.read", "collections.read"].includes(permission)) return { response: null, staff: { organizationId, staffUserId: staffId, grants } };
      return { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null };
    });
    ({ GET: handler } = await import("./route"));
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* pool may not have initialized */ }
    await pool?.end();
    if (testUrl) {
      const admin = new Pool({ connectionString: testUrl, max: 1 });
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
      process.env.DATABASE_URL = testUrl;
    }
  }, 30_000);

  it("finds real appointment overlaps, reports roster advisories and excludes another centre", async () => {
    const patientId = randomUUID(); const patientNumber = `PT-${randomUUID().slice(0, 8)}`;
    await pool!.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',$5)", [patientId, organizationId, centreId, patientNumber, staffId]);
    const firstId = randomUUID(); const secondId = randomUUID(); const otherCentreAppointmentId = randomUUID(); const peerAppointmentId = randomUUID();
    const startsAt = new Date("2026-11-05T10:00:00.000Z");
    for (const [id, number, selectedCentre, start] of [
      [firstId, `RHC-A-${randomUUID().slice(0, 8)}`, centreId, startsAt],
      [secondId, `RHC-A-${randomUUID().slice(0, 8)}`, centreId, new Date(startsAt.getTime() + 15 * 60_000)],
      [otherCentreAppointmentId, `RHC-A-${randomUUID().slice(0, 8)}`, otherCentreId, startsAt],
    ] as const) {
      const patientForCentre = selectedCentre === centreId ? patientId : randomUUID();
      if (selectedCentre !== centreId) await pool!.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',$5)", [patientForCentre, organizationId, selectedCentre, `PT-${randomUUID().slice(0, 8)}`, staffId]);
      await pool!.query("INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,booking_source,visit_type,scheduled_at,duration_minutes,time_zone,status,assigned_staff_id,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'STAFF','CENTRE',$6,30,'Asia/Kolkata','CONFIRMED',$7,'synthetic-ciphertext',$8,$9,$10)", [id, organizationId, selectedCentre, number, patientForCentre, start, staffId, staffId, randomUUID(), "a".repeat(64)]);
    }
    await pool!.query("INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,booking_source,visit_type,scheduled_at,duration_minutes,time_zone,status,assigned_staff_id,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'STAFF','CENTRE',$6,30,'Asia/Kolkata','CONFIRMED',$7,'synthetic-ciphertext',$8,$9,$10)", [peerAppointmentId, organizationId, centreId, `RHC-PEER-${randomUUID().slice(0, 8)}`, patientId, new Date(startsAt.getTime() + 60 * 60_000), peerId, staffId, randomUUID(), "e".repeat(64)]);
    const orderId = randomUUID(); const collectionId = randomUUID();
    await pool!.query("INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)", [orderId, organizationId, centreId, `RHC-O-${randomUUID().slice(0, 8)}`, patientId, firstId, randomUUID(), "d".repeat(64), staffId]);
    await pool!.query("INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,assigned_staff_id,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'ASSIGNED',$8,$9,$10,$11,$12)", [collectionId, organizationId, centreId, `RHC-C-${randomUUID().slice(0, 8)}`, firstId, orderId, patientId, staffId, new Date(startsAt.getTime() + 20 * 60_000), new Date(startsAt.getTime() + 50 * 60_000), randomUUID(), staffId]);
    await pool!.query("INSERT INTO staff_shifts(id,organization_id,centre_id,staff_id,shift_type,status,starts_at,ends_at,time_zone,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'SCHEDULED','ACTIVE',$5,$6,'Asia/Kolkata','synthetic-ciphertext',$4,$7,$8)", [randomUUID(), organizationId, centreId, staffId, new Date(startsAt.getTime() - 15 * 60_000), new Date(startsAt.getTime() + 30 * 60_000), randomUUID(), "b".repeat(64)]);
    await pool!.query("INSERT INTO staff_shifts(id,organization_id,centre_id,staff_id,shift_type,status,starts_at,ends_at,time_zone,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'UNAVAILABLE','ACTIVE',$5,$6,'Asia/Kolkata','synthetic-ciphertext',$4,$7,$8)", [randomUUID(), organizationId, centreId, staffId, new Date(startsAt.getTime() + 15 * 60_000), new Date(startsAt.getTime() + 45 * 60_000), randomUUID(), "c".repeat(64)]);
    await pool!.query("INSERT INTO staff_shifts(id,organization_id,centre_id,staff_id,shift_type,status,starts_at,ends_at,time_zone,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'UNAVAILABLE','ACTIVE',$5,$6,'Asia/Kolkata','synthetic-ciphertext',$7,$8,$9)", [randomUUID(), organizationId, centreId, peerId, new Date(startsAt.getTime() + 60 * 60_000), new Date(startsAt.getTime() + 90 * 60_000), staffId, randomUUID(), "f".repeat(64)]);

    const from = new Date(startsAt.getTime() - 60 * 60_000).toISOString();
    const to = new Date(startsAt.getTime() + 3 * 60 * 60_000).toISOString();
    const response = await handler(new Request(`http://localhost/api/roster/conflicts?centreId=${centreId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
    const result = await response.json() as { conflicts: Array<{ id: string; kind: string; advisoryFlags: string[] }>; appointmentsHaveMore: boolean; collectionsHaveMore: boolean };
    expect(response.status).toBe(200);
    expect(result.conflicts.map((item) => item.id)).toContain(firstId);
    expect(result.conflicts.map((item) => item.id)).toContain(secondId);
    expect(result.conflicts.find((item) => item.id === collectionId)?.kind).toBe("COLLECTION");
    expect(result.conflicts.find((item) => item.id === collectionId)?.advisoryFlags).toContain("OVERLAPPING_ASSIGNMENT");
    expect(result.conflicts.map((item) => item.id)).not.toContain(otherCentreAppointmentId);
    expect(result.conflicts.find((item) => item.id === firstId)?.advisoryFlags).toContain("OVERLAPPING_ASSIGNMENT");
    expect(result.conflicts.find((item) => item.id === secondId)?.advisoryFlags).toEqual(expect.arrayContaining(["OVERLAPPING_ASSIGNMENT", "OUTSIDE_SCHEDULED_SHIFT", "DURING_UNAVAILABILITY"]));
    expect(result.conflicts.find((item) => item.id === peerAppointmentId)?.advisoryFlags).toContain("DURING_UNAVAILABILITY");
    expect(JSON.stringify(result)).not.toContain(patientNumber);

    rosterMode = "SELF_ONLY";
    const selfOnlyResponse = await handler(new Request(`http://localhost/api/roster/conflicts?centreId=${centreId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
    const selfOnly = await selfOnlyResponse.json() as { conflicts: Array<{ id: string; advisoryFlags: string[] }> };
    expect(selfOnlyResponse.status).toBe(200);
    expect(selfOnly.conflicts.map((item) => item.id)).not.toContain(peerAppointmentId);
  });

  it("clears an availability advisory through the versioned appointment reassignment workflow", async () => {
    const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    const patientId = randomUUID();
    const appointmentId = randomUUID();
    const appointmentAt = new Date("2026-11-06T08:00:00.000Z");
    const from = new Date(appointmentAt.getTime() - 60 * 60_000).toISOString();
    const to = new Date(appointmentAt.getTime() + 3 * 60 * 60_000).toISOString();
    const privateDataCiphertext = encryptOperationalData(
      { homeCollectionAddress: null, collectionInstructions: null, communicationEvidenceReference: null, homeChargeReason: null },
      operationalContext({ organizationId, centreId, recordId: appointmentId }, "appointment"),
    );
    await pool!.query(
      "INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',$5)",
      [patientId, organizationId, centreId, `SYN-${seed}`, staffId],
    );
    const peerRoleId = randomUUID();
    await pool!.query("INSERT INTO roles(id,organization_id,key,name,scope) VALUES($1,$2,$3,$4,'CENTRE')", [peerRoleId, organizationId, `roster_target_${seed.toLowerCase()}`, "Synthetic roster target"]);
    await pool!.query(
      "INSERT INTO staff_role_assignments(id,organization_id,staff_user_id,role_id,centre_id,assigned_by_staff_id) VALUES($1,$2,$3,$4,$5,$6)",
      [randomUUID(), organizationId, peerId, peerRoleId, centreId, staffId],
    );
    await pool!.query(
      "INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,booking_source,visit_type,scheduled_at,duration_minutes,time_zone,status,assigned_staff_id,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'STAFF','CENTRE',$6,30,'Asia/Kolkata','CONFIRMED',$7,$8,$9,$10,$11)",
      [appointmentId, organizationId, centreId, `RW-RESOLVE-${seed}`, patientId, appointmentAt, staffId, privateDataCiphertext, staffId, randomUUID(), "a".repeat(64)],
    );
    await pool!.query(
      "INSERT INTO staff_shifts(id,organization_id,centre_id,staff_id,shift_type,status,starts_at,ends_at,time_zone,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,'UNAVAILABLE','ACTIVE',$5,$6,'Asia/Kolkata','synthetic-ciphertext',$7,$8,$9),($10,$2,$3,$11,'SCHEDULED','ACTIVE',$12,$13,'Asia/Kolkata','synthetic-ciphertext',$7,$14,$15)",
      [randomUUID(), organizationId, centreId, staffId, new Date(appointmentAt.getTime() - 15 * 60_000), new Date(appointmentAt.getTime() + 45 * 60_000), staffId, randomUUID(), "b".repeat(64), randomUUID(), peerId, new Date(appointmentAt.getTime() - 30 * 60_000), new Date(appointmentAt.getTime() + 60 * 60_000), randomUUID(), "c".repeat(64)],
    );

    const teamGrants = [
      { key: "roster.read", centreId }, { key: "roster.manage", centreId },
      { key: "appointments.read", centreId }, { key: "appointments.update", centreId }, { key: "appointments.assign", centreId },
    ];
    mocks.getApiAccess.mockImplementation(async (permission: string, requestedCentreId?: string) => {
      if (permission === "workspace.read" && requestedCentreId === undefined) return { response: null, staff: { organizationId, staffUserId: staffId, grants: teamGrants } };
      if (requestedCentreId === centreId && ["roster.read", "appointments.read", "appointments.update", "appointments.assign"].includes(permission)) {
        return { response: null, staff: { organizationId, staffUserId: staffId, grants: teamGrants } };
      }
      return { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null };
    });

    const beforeResponse = await handler(new Request(`http://localhost/api/roster/conflicts?centreId=${centreId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
    const before = await beforeResponse.json() as { conflicts: Array<{ id: string; advisoryFlags: string[] }> };
    expect(beforeResponse.status).toBe(200);
    expect(before.conflicts.find((item) => item.id === appointmentId)?.advisoryFlags).toContain("DURING_UNAVAILABILITY");

    const { PATCH } = await import("../../appointments/[id]/route");
    const [current] = (await pool!.query("SELECT updated_at FROM appointments WHERE id=$1", [appointmentId])).rows;
    const reassigned = await PATCH(new Request(`http://localhost/api/appointments/${appointmentId}`, {
      method: "PATCH",
      headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() },
      body: JSON.stringify({ expectedUpdatedAt: new Date(current.updated_at).toISOString(), assignedStaffId: peerId, reason: "Synthetic availability conflict resolution" }),
    }), { params: Promise.resolve({ id: appointmentId }) });
    expect(reassigned.status).toBe(200);
    expect(await reassigned.json()).toMatchObject({ appointment: { id: appointmentId, assignedStaffId: peerId, status: "ASSIGNED" }, replayed: false });

    const persisted = await pool!.query("SELECT assigned_staff_id,status FROM appointments WHERE id=$1", [appointmentId]);
    const history = await pool!.query("SELECT action,staff_id,previous_staff_id FROM appointment_assignment_history WHERE appointment_id=$1", [appointmentId]);
    expect(persisted.rows[0]).toEqual({ assigned_staff_id: peerId, status: "ASSIGNED" });
    expect(history.rows).toEqual([{ action: "REASSIGNED", staff_id: peerId, previous_staff_id: staffId }]);

    const afterResponse = await handler(new Request(`http://localhost/api/roster/conflicts?centreId=${centreId}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`));
    const after = await afterResponse.json() as { conflicts: Array<{ id: string }> };
    expect(afterResponse.status).toBe(200);
    expect(after.conflicts.map((item) => item.id)).not.toContain(appointmentId);
  });
});
