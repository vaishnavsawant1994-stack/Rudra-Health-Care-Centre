import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { loadProjectEnvironment } from "../../../../scripts/load-project-env.mjs";
import { runMigrations } from "../../../../scripts/migrate.mjs";
import { encryptFinanceReportPrivateData } from "@/server/finance-report-crypto";

const mocks = vi.hoisted(() => ({ getApiAccess: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess: mocks.getApiAccess }));

describe("finance pagination PostgreSQL integration", () => {
  const { Pool } = pg;
  const schema = `p2_09a_finance_page_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  let testUrl = "";
  let pool: InstanceType<typeof Pool>;
  let handler: typeof import("./route").GET;
  let postHandler: typeof import("./route").POST;
  let organizationId: string;
  let centreId: string;
  let staffUserId: string;

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
    organizationId = randomUUID(); centreId = randomUUID(); staffUserId = randomUUID();
    const authUserId = randomUUID();
    await pool.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `FIN-${organizationId.slice(0, 8)}`, "Synthetic finance pagination"]);
    await pool.query("INSERT INTO centres(id,organization_id,code,name,time_zone) VALUES($1,$2,$3,$4,'Asia/Kolkata')", [centreId, organizationId, `FC-${centreId.slice(0, 8)}`, "Synthetic Finance Centre"]);
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authUserId, "Synthetic Finance Reviewer", `${authUserId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',true)", [staffUserId, authUserId, organizationId, `FS-${staffUserId.slice(0, 8)}`, "Synthetic Finance Reviewer"]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "finance.read", centreId }] }, response: null });
    ({ GET: handler, POST: postHandler } = await import("./route"));
    for (const [index, status, method] of [[0, "RECORDED", "CASH"], [1, "CONFIRMED", "UPI"], [2, "DISPUTED", "CASH"]] as const) {
      const id = randomUUID();
      const privateData = encryptFinanceReportPrivateData("finance-payment", { reference: `synthetic-private-${index}` }, { organizationId, centreId, recordId: id });
      await pool.query(
        "INSERT INTO finance_payments(id,organization_id,centre_id,payment_number,method,status,amount_minor,private_data_ciphertext,received_by_staff_id,idempotency_key) VALUES($1,$2,$3,$4,$5,$6,100,$7,$8,$9)",
        [id, organizationId, centreId, `RHC-P-TEST-${index}`, method, status, privateData, staffUserId, randomUUID()],
      );
    }
    for (let index = 0; index < 102; index++) {
      await pool.query(
        "INSERT INTO finance_charges(id,organization_id,centre_id,charge_type,charge_code,amount_minor,snapshot,recorded_by_staff_id,idempotency_key,created_at) VALUES($1,$2,$3,'ADJUSTMENT',$4,100,'{}'::jsonb,$5,$6,now()+($7 * interval '1 second'))",
        [randomUUID(), organizationId, centreId, `SYNTH-${String(index).padStart(3, "0")}`, staffUserId, randomUUID(), index],
      );
    }
  }, 120_000);

  afterAll(async () => {
    try { const { closeDatabasePool } = await import("@/db/client"); await closeDatabasePool(); } catch { /* already closed */ }
    await pool?.end();
    const admin = new Pool({ connectionString: testUrl, max: 1 });
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
    process.env.DATABASE_URL = testUrl;
  });

  it("returns older centre-scoped finance rows on later pages without truncating totals", async () => {
    const request = (page: string) => new Request(`http://localhost/api/finance?centreId=${centreId}&page=${page}`);
    const first = await handler(request("1"));
    const firstBody = await first.json() as { charges: Array<{ chargeCode: string }>; summary: { activeCharges: number }; pagination: { page: number; pageSize: number; hasMore: { charges: boolean } } };
    expect(first.status).toBe(200);
    expect(firstBody.charges).toHaveLength(100);
    expect(firstBody.pagination).toEqual({ page: 1, pageSize: 100, hasMore: expect.objectContaining({ charges: true }) });
    expect(firstBody.summary.activeCharges).toBe(102);

    const second = await handler(request("2"));
    const secondBody = await second.json() as { charges: Array<{ chargeCode: string }>; pagination: { page: number; hasMore: { charges: boolean } } };
    expect(secondBody.charges).toHaveLength(2);
    expect(secondBody.charges.map(charge => charge.chargeCode).sort()).toEqual(["SYNTH-000", "SYNTH-001"]);
    expect(secondBody.pagination.page).toBe(2);
    expect(secondBody.pagination.hasMore.charges).toBe(false);
  });

  it("rejects invalid and oversized page values", async () => {
    expect((await handler(new Request("http://localhost/api/finance?page=0"))).status).toBe(400);
    expect((await handler(new Request("http://localhost/api/finance?page=1000000"))).status).toBe(400);
  });

  it("filters payments by internal number, status, method and centre without searching encrypted references", async () => {
    const response = await handler(new Request(`http://localhost/api/finance?centreId=${centreId}&paymentSearch=RHC-P-TEST-0&paymentStatus=RECORDED&paymentMethod=CASH`));
    const body = await response.json() as { payments: Array<{ paymentNumber: string; status: string; method: string; reference: string }> };
    expect(response.status).toBe(200);
    expect(body.payments).toHaveLength(1);
    expect(body.payments[0]).toMatchObject({ paymentNumber: "RHC-P-TEST-0", status: "RECORDED", method: "CASH", reference: "synthetic-private-0" });
    const noPrivateReferenceMatch = await handler(new Request(`http://localhost/api/finance?centreId=${centreId}&paymentSearch=synthetic-private`));
    expect((await noPrivateReferenceMatch.json()).payments).toHaveLength(0);
  });

  it("rejects invalid payment filter values", async () => {
    expect((await handler(new Request("http://localhost/api/finance?paymentStatus=UNKNOWN"))).status).toBe(400);
    expect((await handler(new Request("http://localhost/api/finance?paymentMethod=UNKNOWN"))).status).toBe(400);
    expect((await handler(new Request("http://localhost/api/finance?paymentSearch=private%20reference"))).status).toBe(400);
  });

  it("snapshots non-cash ledger totals at close without claiming provider settlement", async () => {
    const openResponse = await postHandler(new Request("http://localhost/api/finance", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "open_reconciliation", centreId, openingCashMinor: 0 }) }));
    expect(openResponse.status).toBe(201);
    const { result: { reconciliationId } } = await openResponse.json() as { result: { reconciliationId: string } };
    const sessionPaymentId = randomUUID();
    const sessionPrivateData = encryptFinanceReportPrivateData("finance-payment", { reference: "synthetic-session-upi" }, { organizationId, centreId, recordId: sessionPaymentId });
    await pool.query("INSERT INTO finance_payments(id,organization_id,centre_id,payment_number,method,status,amount_minor,private_data_ciphertext,received_by_staff_id,idempotency_key) VALUES($1,$2,$3,$4,'UPI','CONFIRMED',101,$5,$6,$7)", [sessionPaymentId, organizationId, centreId, "RHC-P-SESSION-SYNTH", sessionPrivateData, staffUserId, randomUUID()]);

    const openRead = await handler(new Request(`http://localhost/api/finance?centreId=${centreId}`));
    const openBody = await openRead.json() as { reconciliations: Array<{ id: string; nonCashSummary: { capturedAt: string | null; payments: Array<{ method: string; status: string; paymentCount: number; amountMinor: string }> } }> };
    expect(openRead.status).toBe(200);
    expect(openBody.reconciliations.map(item => item.id)).toContain(reconciliationId);
    const liveSummary = openBody.reconciliations.find(item => item.id === reconciliationId)?.nonCashSummary;
    expect(liveSummary?.capturedAt).toBeNull();
    expect(liveSummary?.payments).toContainEqual({ method: "UPI", status: "CONFIRMED", paymentCount: 1, amountMinor: "101" });

    const secondAuthUserId = randomUUID();
    const closerId = randomUUID();
    await pool.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [secondAuthUserId, "Synthetic Independent Closer", `${secondAuthUserId}@invalid.test`]);
    await pool.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',true)", [closerId, secondAuthUserId, organizationId, `FC-${closerId.slice(0, 8)}`, "Synthetic Independent Closer"]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId: closerId, grants: [{ key: "finance.reconcile", centreId }] }, response: null });
    const closeResponse = await postHandler(new Request("http://localhost/api/finance", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": randomUUID() }, body: JSON.stringify({ action: "close_reconciliation", reconciliationId, expectedVersion: 1, countedCashMinor: 0, reason: "Synthetic end-of-session count" }) }));
    const closeResponseBody = await closeResponse.json() as { result?: { nonCashSummary: { capturedAt: string; payments: Array<{ method: string; status: string; paymentCount: number; amountMinor: string }> } }; error?: string };
    expect(closeResponse.status, closeResponseBody.error).toBe(201);
    const closeBody = closeResponseBody.result!;
    expect(closeBody.nonCashSummary.capturedAt).toEqual(expect.any(String));
    expect(closeBody.nonCashSummary.payments).toContainEqual({ method: "UPI", status: "CONFIRMED", paymentCount: 1, amountMinor: "101" });

    const laterId = randomUUID();
    const laterPrivateData = encryptFinanceReportPrivateData("finance-payment", { reference: "synthetic-later-payment" }, { organizationId, centreId, recordId: laterId });
    await pool.query("INSERT INTO finance_payments(id,organization_id,centre_id,payment_number,method,status,amount_minor,private_data_ciphertext,received_by_staff_id,idempotency_key) VALUES($1,$2,$3,$4,'CARD_TERMINAL','CONFIRMED',999,$5,$6,$7)", [laterId, organizationId, centreId, "RHC-P-LATE-SYNTH", laterPrivateData, staffUserId, randomUUID()]);
    mocks.getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "finance.read", centreId }, { key: "finance.reconcile", centreId }] }, response: null });
    const closedRead = await handler(new Request(`http://localhost/api/finance?centreId=${centreId}`));
    const closedBody = await closedRead.json() as { reconciliations: Array<{ id: string; nonCashSummary: { capturedAt: string | null; payments: Array<{ method: string; amountMinor: string }> } }> };
    const saved = closedBody.reconciliations.find(item => item.id === reconciliationId)?.nonCashSummary;
    expect(saved?.capturedAt).toEqual(expect.any(String));
    expect(saved?.payments.some(item => item.method === "CARD_TERMINAL")).toBe(false);
  });
});
