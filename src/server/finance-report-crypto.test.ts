import { afterEach, describe, expect, it } from "vitest";
import { decryptFinanceReportPrivateData, encryptFinanceReportPrivateData } from "./finance-report-crypto";

const previous = { keys: process.env.RUDRA_FIELD_ENCRYPTION_KEYS, id: process.env.RUDRA_FIELD_ACTIVE_KEY_ID };
const context = { organizationId: "org-synthetic", centreId: "centre-synthetic", recordId: "record-synthetic" };
afterEach(() => {
  if (previous.keys === undefined) delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS; else process.env.RUDRA_FIELD_ENCRYPTION_KEYS = previous.keys;
  if (previous.id === undefined) delete process.env.RUDRA_FIELD_ACTIVE_KEY_ID; else process.env.RUDRA_FIELD_ACTIVE_KEY_ID = previous.id;
});

describe("finance and report metadata encryption", () => {
  it("round-trips private metadata with entity and record context", () => {
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "test-v1";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ "test-v1": Buffer.alloc(32, 51).toString("base64") });
    const value = { evidenceReference: "SYNTHETIC-EVIDENCE", reason: "Synthetic reconciliation note" };
    const envelope = encryptFinanceReportPrivateData("finance-event", value, context);
    expect(envelope).not.toContain("SYNTHETIC-EVIDENCE");
    expect(decryptFinanceReportPrivateData("finance-event", envelope, context)).toEqual(value);
    expect(() => decryptFinanceReportPrivateData("report-event", envelope, context)).toThrow("operational_data_integrity_failed");
    expect(() => decryptFinanceReportPrivateData("finance-event", envelope, { ...context, recordId: "other-record" })).toThrow("operational_data_integrity_failed");
  });

  it("supports staged key rotation while the previous key remains in the key ring", () => {
    const oldKey = Buffer.alloc(32, 52).toString("base64"), nextKey = Buffer.alloc(32, 53).toString("base64");
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "old";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ old: oldKey });
    const oldEnvelope = encryptFinanceReportPrivateData("report-delivery", { recipientLabel: "Synthetic recipient" }, context);
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "next";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ old: oldKey, next: nextKey });
    expect(decryptFinanceReportPrivateData("report-delivery", oldEnvelope, context)).toEqual({ recipientLabel: "Synthetic recipient" });
    const newEnvelope = encryptFinanceReportPrivateData("report-delivery", { recipientLabel: "Synthetic recipient" }, context);
    expect(newEnvelope.split(".")[1]).toBe("next");
    expect(decryptFinanceReportPrivateData("report-delivery", newEnvelope, context)).toEqual({ recipientLabel: "Synthetic recipient" });
  });

  it("fails closed for absent or incorrect encryption keys", () => {
    process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "known";
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ known: Buffer.alloc(32, 54).toString("base64") });
    const envelope = encryptFinanceReportPrivateData("finance-refund", { reason: "Synthetic" }, context);
    process.env.RUDRA_FIELD_ENCRYPTION_KEYS = JSON.stringify({ known: Buffer.alloc(32, 55).toString("base64") });
    expect(() => decryptFinanceReportPrivateData("finance-refund", envelope, context)).toThrow("operational_data_integrity_failed");
    delete process.env.RUDRA_FIELD_ENCRYPTION_KEYS;
    expect(() => decryptFinanceReportPrivateData("finance-refund", envelope, context)).toThrow("operational_encryption_key_unavailable");
  });
});
