import { beforeEach, describe, expect, it, vi } from "vitest";
import { collectionJobs, sampleCustodyEvents, specimens } from "@/db/schema";
import { encryptOperationalData, operationalContext } from "@/server/operational-crypto";
import { GET, POST } from "./route";

const { getApiAccess, getDb } = vi.hoisted(() => ({ getApiAccess: vi.fn(), getDb: vi.fn() }));
vi.mock("@/server/access", () => ({ getApiAccess }));
vi.mock("@/db/client", () => ({ getDb }));

describe("specimen collection API boundary", () => {
  beforeEach(() => { getApiAccess.mockReset(); getDb.mockReset(); });
  const payload = { action: "collect", jobId: "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5", specimenType: "Synthetic tube", requirementReference: "SYNTHETIC-SOP-1", identityCheckConfirmed: true, procedureApprovalId: "a8bad75c-b226-46d8-b238-86501998dd41", reason: "Synthetic collection verification" };
  const req = (key?: string, origin = "http://localhost") => new Request("http://localhost/api/samples", { method: "POST", headers: { origin, "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: JSON.stringify(payload) });
  const handoverPayload = { action: "submit_for_receiving", specimenId: "af0f6a69-ccf2-4a6e-a329-150215537d87", expectedVersion: 1, reason: "Synthetic submission" };
  const handoverRequest = (key?: string) => new Request("http://localhost/api/samples", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: JSON.stringify(handoverPayload) });
  const receivePayload = { action: "receive", specimenId: "af0f6a69-ccf2-4a6e-a329-150215537d87", expectedVersion: 1, procedureApprovalId: "a8bad75c-b226-46d8-b238-86501998dd41", reason: "Synthetic receiving verification" };
  const receiveRequest = (key?: string) => new Request("http://localhost/api/samples", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", ...(key ? { "idempotency-key": key } : {}) }, body: JSON.stringify(receivePayload) });
  it("does not return sample directory data to signed-out or MFA-incomplete sessions", async () => {
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    expect((await GET(new Request("http://localhost/api/samples"))).status).toBe(401);
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    const response = await GET(new Request("http://localhost/api/samples"));
    expect(response.status).toBe(428);
    expect(await response.json()).toEqual({ error: "mfa_setup_required" });
    expect(getApiAccess).toHaveBeenCalledTimes(2);
  });
  it("rejects unknown queue views after requiring an authorized sample session", async () => {
    getApiAccess.mockResolvedValueOnce({ staff: { grants: [] }, response: null });
    const response = await GET(new Request("http://localhost/api/samples?view=patient-identities"));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_sample_view" });
  });
  it("requires a valid sample-exception identifier and the exceptions view for direct links", async () => {
    getApiAccess.mockResolvedValue({ staff: { grants: [] }, response: null });
    const invalidId = await GET(new Request("http://localhost/api/samples?view=exceptions&exceptionId=not-a-uuid"));
    expect(invalidId.status).toBe(400);
    expect(await invalidId.json()).toEqual({ error: "invalid_exception_filter" });
    const wrongView = await GET(new Request("http://localhost/api/samples?view=all&exceptionId=af0f6a69-ccf2-4a6e-a329-150215537d87"));
    expect(wrongView.status).toBe(400);
    expect(await wrongView.json()).toEqual({ error: "invalid_exception_filter" });
    expect(getDb).not.toHaveBeenCalled();
  });
  it("resolves a direct exception link only through the authorized sample directory query", async () => {
    const centreId = "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5";
    const exceptionId = "df06f838-b143-4b89-bbf8-b38aad6b7d2d";
    const specimenId = "af0f6a69-ccf2-4a6e-a329-150215537d87";
    const organizationId = "4779fa43-bd9d-4fb3-bdd9-2f7202485196";
    const previousKeyId = process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
    const previousKeyring = process.env.RUDRA_FIELD_ENCRYPTION_KEYS;
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "sample-exception-link-test";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ "sample-exception-link-test": Buffer.alloc(32, 9).toString("base64") });
    try {
      const privateDataCiphertext = encryptOperationalData({ specimenType: "Synthetic sample", requirementReference: "SYNTHETIC-EXCEPTION-REF" }, operationalContext({ organizationId, centreId, recordId: specimenId }, "specimen"));
      const query = { from: vi.fn(), innerJoin: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), offset: vi.fn() };
      for (const method of [query.from, query.innerJoin, query.where, query.orderBy, query.limit]) method.mockReturnValue(query);
      query.offset.mockResolvedValue([{ id: specimenId, organizationId, centreId, jobId: "synthetic-job", orderId: "synthetic-order", patientId: "synthetic-patient", encryptionKeyId: "key-v1", nameCiphertext: "encrypted-name", specimenNumber: "RHC-S-SYNTHETIC-EXCEPTION", privateDataCiphertext, status: "EXCEPTION", collectedAt: new Date("2026-10-30T10:00:00Z"), receivedAt: null, versionNumber: 2 }]);
      getDb.mockReturnValue({ select: vi.fn(() => query) });
      getApiAccess.mockResolvedValueOnce({ staff: { staffUserId: "reader-1", organizationId, grants: [{ key: "samples.read", centreId }] }, response: null });

      const response = await GET(new Request(`http://localhost/api/samples?view=exceptions&centreId=${centreId}&exceptionId=${exceptionId}`));
      expect(response.status).toBe(200);
      expect(getApiAccess).toHaveBeenCalledWith("samples.read", centreId);
      expect(query.where).toHaveBeenCalled();
      const body = await response.json();
      expect(body.specimens).toHaveLength(1);
      expect(body.specimens[0]).toMatchObject({ id: specimenId, centreId, status: "EXCEPTION", specimenType: "Synthetic sample" });
    } finally {
      if (previousKeyId === undefined) delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; else process.env.RUDRA_FIELD_ACTIVE_KEY_ID = previousKeyId;
      if (previousKeyring === undefined) delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; else process.env.RUDRA_FIELD_ENCRYPTION_KEYS = previousKeyring;
    }
  });
  it("validates and rechecks a selected centre before querying samples", async () => {
    const centreId = "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5";
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    expect((await GET(new Request(`http://localhost/api/samples?centreId=${centreId}`))).status).toBe(403);
    expect(getApiAccess).toHaveBeenCalledWith("samples.read", centreId);
    getApiAccess.mockResolvedValueOnce({ staff: { grants: [] }, response: null });
    const invalid = await GET(new Request("http://localhost/api/samples?centreId=not-a-uuid"));
    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "invalid_centre" });
  });
  it("allows visit-only staff to read a minimal handover projection and rejects broader views", async () => {
    const centreId = "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5";
    const assignedStaffId = "5f8f3d2c-3d55-4bf4-8a37-fec87779e990";
    const query = { from: vi.fn(), innerJoin: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), offset: vi.fn() };
    for (const method of [query.from, query.innerJoin, query.where, query.orderBy, query.limit]) method.mockReturnValue(query);
    query.offset.mockResolvedValue([{ id: "specimen-1", centreId, jobId: "job-1", specimenNumber: "RHC-S-SYNTHETIC", status: "COLLECTED", collectedAt: new Date("2026-10-30T10:00:00Z"), versionNumber: 1, receivingSubmissionRequired: true, handoverSubmitted: false, patientId: "private-patient", orderId: "private-order", nameCiphertext: "ciphertext", privateDataCiphertext: "private-ciphertext", specimenType: "private-type" }]);
    getDb.mockReturnValue({ select: vi.fn(() => query) });
    getApiAccess
      .mockResolvedValueOnce({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) })
      .mockResolvedValueOnce({ staff: { staffUserId: assignedStaffId, organizationId: "org-1", grants: [{ key: "collections.visit.record", centreId }] }, response: null });

    const response = await GET(new Request("http://localhost/api/samples?view=handover"));
    expect(response.status).toBe(200);
    expect(getApiAccess).toHaveBeenNthCalledWith(1, "samples.read", undefined);
    expect(getApiAccess).toHaveBeenNthCalledWith(2, "collections.visit.record", undefined);
    const body = await response.json();
    expect(body.specimens).toEqual([{ id: "specimen-1", centreId, jobId: "job-1", specimenNumber: "RHC-S-SYNTHETIC", status: "COLLECTED", collectedAt: "2026-10-30T10:00:00.000Z", versionNumber: 1, receivingSubmissionRequired: true, handoverSubmitted: false, canSubmitHandover: true }]);
    expect(JSON.stringify(body)).not.toContain("private-patient");
    expect(JSON.stringify(body)).not.toContain("private-order");
    expect(JSON.stringify(body)).not.toContain("private-ciphertext");

    getApiAccess.mockReset().mockResolvedValueOnce({ staff: null, response: Response.json({ error: "forbidden" }, { status: 403 }) });
    expect((await GET(new Request("http://localhost/api/samples?view=all"))).status).toBe(403);
    expect(getApiAccess).toHaveBeenCalledTimes(1);
  });
  it("decrypts sample type and requirement for sample readers without disclosing patient identity", async () => {
    const previousKeyId = process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
    const previousKeyring = process.env.RUDRA_FIELD_ENCRYPTION_KEYS;
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "sample-route-test";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ "sample-route-test": Buffer.alloc(32, 7).toString("base64") });
    try {
    const centreId = "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5";
    const specimenId = "af0f6a69-ccf2-4a6e-a329-150215537d87";
    const organizationId = "4779fa43-bd9d-4fb3-bdd9-2f7202485196";
    const privateDataCiphertext = encryptOperationalData({ specimenType: "Synthetic serum tube", requirementReference: "SYNTHETIC-SOP-3" }, operationalContext({ organizationId, centreId, recordId: specimenId }, "specimen"));
    const query = { from: vi.fn(), innerJoin: vi.fn(), where: vi.fn(), orderBy: vi.fn(), limit: vi.fn(), offset: vi.fn() };
    for (const method of [query.from, query.innerJoin, query.where, query.orderBy, query.limit]) method.mockReturnValue(query);
    query.offset.mockResolvedValue([{ id: specimenId, organizationId, centreId, jobId: "synthetic-job", orderId: "synthetic-order", patientId: "synthetic-patient", encryptionKeyId: "key-v1", nameCiphertext: "encrypted-name", specimenNumber: "RHC-S-SYNTHETIC-2", privateDataCiphertext, status: "COLLECTED", collectedAt: new Date("2026-10-30T10:00:00Z"), receivedAt: null, versionNumber: 1 }]);
    getDb.mockReturnValue({ select: vi.fn(() => query) });
    getApiAccess.mockResolvedValueOnce({ staff: { staffUserId: "reader-1", organizationId, grants: [{ key: "samples.read", centreId }] }, response: null });

    const response = await GET(new Request("http://localhost/api/samples?view=all"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.specimens).toHaveLength(1);
    expect(body.specimens[0]).toMatchObject({ id: specimenId, centreId, specimenType: "Synthetic serum tube", requirementReference: "SYNTHETIC-SOP-3", specimenNumber: "RHC-S-SYNTHETIC-2" });
    expect(body.specimens[0]).not.toHaveProperty("patientId");
    expect(body.specimens[0]).not.toHaveProperty("nameCiphertext");
    expect(body.specimens[0]).not.toHaveProperty("privateDataCiphertext");
    } finally {
      if (previousKeyId === undefined) delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; else process.env.RUDRA_FIELD_ACTIVE_KEY_ID = previousKeyId;
      if (previousKeyring === undefined) delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; else process.env.RUDRA_FIELD_ENCRYPTION_KEYS = previousKeyring;
    }
  });
  it("requires an idempotency key and rejects unauthenticated or MFA-incomplete requests", async () => {
    expect((await POST(req())).status).toBe(400);
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    expect((await POST(req("972b2aed-30f9-4c01-9473-b8db9a6db88c"))).status).toBe(401);
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    expect((await POST(req("df2d1773-3cfb-49f3-9370-d0b9d74389fe"))).status).toBe(428);
  });
  it("replays an exact specimen collection request and rejects changed evidence under the same key", async () => {
    const organizationId = "4779fa43-bd9d-4fb3-bdd9-2f7202485196";
    const centreId = "c1aeacbb-bf66-44f0-a27a-7bf06c60a6b5";
    const staffUserId = "5f8f3d2c-3d55-4bf4-8a37-fec87779e990";
    const specimenId = "af0f6a69-ccf2-4a6e-a329-150215537d87";
    const eventId = "df06f838-b143-4b89-bbf8-b38aad6b7d2d";
    const key = "972b2aed-30f9-4c01-9473-b8db9a6db88c";
    const priorId = process.env.RUDRA_FIELD_ACTIVE_KEY_ID;
    const priorKeys = process.env.RUDRA_FIELD_ENCRYPTION_KEYS;
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "sample-replay-test";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ "sample-replay-test": Buffer.alloc(32, 7).toString("base64") });
    try {
      const job = { id: payload.jobId, organizationId, centreId, assignedStaffId: staffUserId, status: "IN_PROGRESS" };
      const duplicate = {
        id: specimenId, organizationId, centreId, specimenNumber: "RHC-S-SYNTHETIC-REPLAY", status: "COLLECTED",
        privateDataCiphertext: encryptOperationalData({ specimenType: payload.specimenType, requirementReference: payload.requirementReference }, operationalContext({ organizationId, centreId, recordId: specimenId }, "specimen")),
        collectedByStaffId: staffUserId, jobId: job.id, identityCheckConfirmed: true, procedureApprovalId: payload.procedureApprovalId, versionNumber: 1,
      };
      const collectionEvent = {
        id: eventId,
        privateDataCiphertext: encryptOperationalData({ evidenceReference: null, reason: payload.reason }, operationalContext({ organizationId, centreId, recordId: eventId }, "sample-custody-event")),
      };
      const rowsFor = (table: unknown) => table === collectionJobs ? [job] : table === specimens ? [duplicate] : table === sampleCustodyEvents ? [collectionEvent] : [];
      const query = () => {
        let table: unknown;
        const builder = {
          from: vi.fn((value: unknown) => { table = value; return builder; }),
          where: vi.fn(() => builder),
          for: vi.fn(() => builder),
          limit: vi.fn(async () => rowsFor(table)),
        };
        return builder;
      };
      const tx = { select: vi.fn(() => query()) };
      getDb.mockReturnValue({ select: vi.fn(() => query()), transaction: (run: (transaction: typeof tx) => unknown) => run(tx) });
      getApiAccess.mockResolvedValue({ staff: { organizationId, staffUserId, grants: [{ key: "samples.collect", centreId }] }, response: null });

      const exactReplay = await POST(req(key));
      expect(exactReplay.status).toBe(200);
      expect((await exactReplay.json()).result).toMatchObject({ id: specimenId, replayed: true });

      const changedReasonRequest = new Request("http://localhost/api/samples", { method: "POST", headers: { origin: "http://localhost", "content-type": "application/json", "idempotency-key": key }, body: JSON.stringify({ ...payload, reason: "Different synthetic evidence" }) });
      const conflict = await POST(changedReasonRequest);
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toEqual({ error: "idempotency_conflict" });
    } finally {
      if (priorId === undefined) delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; else process.env.RUDRA_FIELD_ACTIVE_KEY_ID = priorId;
      if (priorKeys === undefined) delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; else process.env.RUDRA_FIELD_ENCRYPTION_KEYS = priorKeys;
    }
  });
  it("requires idempotency, a complete MFA session, and permission for handover submissions", async () => {
    expect((await POST(handoverRequest())).status).toBe(400);
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "authentication_required" }, { status: 401 }) });
    expect((await POST(handoverRequest("972b2aed-30f9-4c01-9473-b8db9a6db88c"))).status).toBe(401);
    getApiAccess.mockResolvedValueOnce({ staff: null, response: Response.json({ error: "mfa_setup_required" }, { status: 428 }) });
    expect((await POST(handoverRequest("df2d1773-3cfb-49f3-9370-d0b9d74389fe"))).status).toBe(428);
  });
  it("requires an idempotency key for physical receiving before any record lookup", async () => {
    expect((await POST(receiveRequest())).status).toBe(400);
    expect(await (await POST(receiveRequest())).json()).toEqual({ error: "valid_idempotency_key_required" });
    expect(getApiAccess).not.toHaveBeenCalled();
  });
  it("rejects cross-origin mutations before authorization or persistence", async () => {
    expect((await POST(req("df2d1773-3cfb-49f3-9370-d0b9d74389fe", "https://attacker.invalid"))).status).toBe(403);
    expect(getApiAccess).not.toHaveBeenCalled();
  });
});
