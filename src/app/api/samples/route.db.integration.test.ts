import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../scripts/migrate.mjs";
import { encryptOperationalData, operationalContext } from "@/server/operational-crypto";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("sample collection API PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_sample_collect_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool> | undefined;
  let originalDatabaseUrl: string | undefined;
  let collectHandler: typeof import("./route").POST;
  let organizationId: string;
  let centreId: string;
  let patientId: string;
  let appointmentId: string;
  let orderId: string;
  let jobId: string;
  let collectorId: string;
  let procedureId: string;
  let idempotencyKey: string;

  beforeAll(async () => {
    loadProjectEnvironment();
    testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) {
      throw new Error("A dedicated test database is required.");
    }
    originalDatabaseUrl = process.env.DATABASE_URL;
    const admin = new Pool({ connectionString: testUrl, max: 1 });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await admin.end();
    await runMigrations(testUrl, null, schema);
    const scopedUrl = new URL(testUrl);
    scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
    process.env.DATABASE_URL = scopedUrl.toString();
    pool = new Pool({ connectionString: scopedUrl.toString(), max: 1 });

    organizationId = randomUUID();
    centreId = randomUUID();
    patientId = randomUUID();
    appointmentId = randomUUID();
    orderId = randomUUID();
    jobId = randomUUID();
    collectorId = randomUUID();
    procedureId = randomUUID();
    idempotencyKey = randomUUID();

    const authId = randomUUID();
    const seed = randomUUID().replaceAll("-", "").slice(0, 8).toUpperCase();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `SC-${seed}`, "Synthetic sample collection"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [centreId, organizationId, `SC-${seed}`, "Synthetic collection centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authId, "Synthetic collector", `${seed.toLowerCase()}@invalid.test`]);
    await pool.query(
      "INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',false)",
      [collectorId, authId, organizationId, `SC-${seed}`, "Synthetic collector"],
    );
    await pool.query(
      "INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',$5)",
      [patientId, organizationId, centreId, `SYN-${seed}`, collectorId],
    );
    const appointmentPrivateData = encryptOperationalData(
      { homeCollectionAddress: null, collectionInstructions: null, communicationEvidenceReference: null, homeChargeReason: null },
      operationalContext({ organizationId, centreId, recordId: appointmentId }, "appointment"),
    );
    await pool.query(
      "INSERT INTO appointments(id,organization_id,centre_id,appointment_number,patient_id,booking_source,visit_type,scheduled_at,duration_minutes,time_zone,status,private_data_ciphertext,created_by_staff_id,idempotency_key,request_hash) VALUES($1,$2,$3,$4,$5,'STAFF','HOME_COLLECTION',$6,30,'Asia/Kolkata','CONFIRMED',$7,$8,$9,$10)",
      [appointmentId, organizationId, centreId, `SA-${seed}`, patientId, new Date("2026-11-10T08:00:00.000Z"), appointmentPrivateData, collectorId, randomUUID(), "a".repeat(64)],
    );
    await pool.query(
      "INSERT INTO diagnostic_orders(id,organization_id,centre_id,order_number,patient_id,appointment_id,status,idempotency_key,request_hash,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,'DRAFT',$7,$8,$9)",
      [orderId, organizationId, centreId, `SO-${seed}`, patientId, appointmentId, randomUUID(), "b".repeat(64), collectorId],
    );
    await pool.query(
      "INSERT INTO collection_jobs(id,organization_id,centre_id,job_number,appointment_id,order_id,patient_id,status,assigned_staff_id,scheduled_start,scheduled_end,idempotency_key,created_by_staff_id) VALUES($1,$2,$3,$4,$5,$6,$7,'IN_PROGRESS',$8,$9,$10,$11,$8)",
      [jobId, organizationId, centreId, `SJ-${seed}`, appointmentId, orderId, patientId, collectorId, new Date("2026-11-10T08:00:00.000Z"), new Date("2026-11-10T08:30:00.000Z"), randomUUID()],
    );
    await pool.query(
      "INSERT INTO sample_procedure_approvals(id,organization_id,centre_id,operation,reference,status,approved_by_staff_id) VALUES($1,$2,$3,'COLLECTION',$4,'ACTIVE',$5)",
      [procedureId, organizationId, centreId, `SYNTHETIC-${seed}`, collectorId],
    );

    const grants = [{ key: "samples.collect", centreId }];
    mocks.getApiAccess.mockImplementation(async (_permission: string, requestedCentreId?: string) => {
      if (requestedCentreId === undefined || requestedCentreId === centreId) {
        return { response: null, staff: { organizationId, staffUserId: collectorId, grants } };
      }
      return { response: Response.json({ error: "forbidden" }, { status: 403 }), staff: null };
    });
    ({ POST: collectHandler } = await import("./route"));
  }, 120_000);

  afterAll(async () => {
    try {
      const { closeDatabasePool } = await import("@/db/client");
      await closeDatabasePool();
    } catch { /* pool may not have initialized */ }
    await pool?.end();
    if (testUrl) {
      const admin = new Pool({ connectionString: testUrl, max: 1 });
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.end();
    }
    if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = originalDatabaseUrl;
  }, 30_000);

  it("persists a synthetic specimen, exactly replays it, and rejects changed evidence under the same key", async () => {
    const body = {
      action: "collect",
      jobId,
      specimenType: "Synthetic specimen type",
      requirementReference: "SYNTHETIC-REQ-1",
      identityCheckConfirmed: true,
      procedureApprovalId: procedureId,
      reason: "Synthetic collection acceptance test",
    };
    const send = (payload: typeof body) => collectHandler(new Request("http://localhost/api/samples", {
      method: "POST",
      headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": idempotencyKey },
      body: JSON.stringify(payload),
    }));

    const created = await send(body);
    expect(created.status).toBe(201);
    const createdPayload = await created.json() as { result: { id: string; status: string; versionNumber: number; replayed: boolean } };
    expect(createdPayload.result).toMatchObject({ status: "COLLECTED", versionNumber: 1, replayed: false });

    const exactRetry = await send(body);
    expect(exactRetry.status).toBe(200);
    expect(await exactRetry.json()).toEqual({ result: { ...createdPayload.result, replayed: true } });

    const changedRetry = await send({ ...body, reason: "Different synthetic collection evidence" });
    expect(changedRetry.status).toBe(409);
    expect(await changedRetry.json()).toEqual({ error: "idempotency_conflict" });

    const persisted = await pool!.query(
      "SELECT id,status,version_number,private_data_ciphertext FROM specimens WHERE organization_id=$1 AND idempotency_key=$2",
      [organizationId, idempotencyKey],
    );
    expect(persisted.rowCount).toBe(1);
    expect(persisted.rows[0]).toMatchObject({ id: createdPayload.result.id, status: "COLLECTED", version_number: 1 });
    expect(persisted.rows[0].private_data_ciphertext).toMatch(/^v1\./);
    const custody = await pool!.query(
      "SELECT event_type,private_data_ciphertext FROM sample_custody_events WHERE organization_id=$1 AND specimen_id=$2 AND event_type='COLLECTED'",
      [organizationId, createdPayload.result.id],
    );
    expect(custody.rowCount).toBe(1);
    expect(custody.rows[0].private_data_ciphertext).toMatch(/^v1\./);
    const jobEvents = await pool!.query("SELECT event_type FROM collection_job_events WHERE organization_id=$1 AND job_id=$2", [organizationId, jobId]);
    expect(jobEvents.rows.map((row) => row.event_type)).toEqual(["COLLECTION_RECORDED"]);
    const audit = await pool!.query(
      "SELECT action FROM audit_events WHERE organization_id=$1 AND entity_id=$2 AND action='specimen.collected'",
      [organizationId, createdPayload.result.id],
    );
    expect(audit.rows).toEqual([{ action: "specimen.collected" }]);
  });
});
