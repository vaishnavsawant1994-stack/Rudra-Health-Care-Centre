import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { persistReportPdf, readReportPdf, removeReportPdf, safeReportStorageKey } from "../src/server/report-storage.ts";
import { encryptOperationalData, decryptOperationalData } from "../src/server/operational-crypto.ts";
import { collectEncryptionKeyMaterial, decryptKeyBackup, encryptKeyBackup, mergeRecoveredKeysIntoLocalEnv, readKeyBackup, writeNewKeyBackup } from "./key-recovery.mjs";

const passphrase = "synthetic-recovery-passphrase-2026";
const env = {
  REPORT_DOCUMENT_ACTIVE_KEY_ID: "report-current",
  REPORT_DOCUMENT_ENCRYPTION_KEYS: JSON.stringify({ "report-old": Buffer.alloc(32, 1).toString("base64"), "report-current": Buffer.alloc(32, 2).toString("base64") }),
  RUDRA_FIELD_ACTIVE_KEY_ID: "field-current",
  RUDRA_FIELD_ENCRYPTION_KEYS: JSON.stringify({ "field-old": Buffer.alloc(32, 3).toString("base64"), "field-current": Buffer.alloc(32, 4).toString("base64") }),
  RUDRA_BLIND_INDEX_KEY: Buffer.alloc(32, 5).toString("base64"),
};
const directories = new Set();
afterEach(async () => { await Promise.all([...directories].map((directory) => rm(directory, { recursive: true, force: true }))); directories.clear(); });

describe("local encryption key recovery", () => {
  it("authenticates a backup and preserves active plus historical keys", async () => {
    const material = collectEncryptionKeyMaterial(env);
    const backup = await encryptKeyBackup(material, passphrase);
    const serialized = JSON.stringify(backup);
    expect(serialized).not.toContain(Buffer.alloc(32, 2).toString("base64"));
    expect(serialized).not.toContain(Buffer.alloc(32, 5).toString("base64"));
    expect(await decryptKeyBackup(backup, passphrase)).toEqual(material);
  });

  it("restores the keys needed to decrypt synthetic encrypted fields and report files after key loss", async () => {
    const names = Object.keys(env);
    const prior = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    const reportStorageKey = safeReportStorageKey();
    const historicalReportStorageKey = safeReportStorageKey();
    try {
      for (const [name, value] of Object.entries(env)) process.env[name] = value;
      const reportBytes = Buffer.from("%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n", "utf8");
      process.env.REPORT_DOCUMENT_ACTIVE_KEY_ID = "report-old";
      await persistReportPdf(historicalReportStorageKey, reportBytes);
      process.env.REPORT_DOCUMENT_ACTIVE_KEY_ID = env.REPORT_DOCUMENT_ACTIVE_KEY_ID;
      await persistReportPdf(reportStorageKey, reportBytes);
      const fieldContext = { organizationId: "22222222-2222-4222-8222-222222222222", centreId: "33333333-3333-4333-8333-333333333333", recordType: "synthetic-recovery", recordId: "44444444-4444-4444-8444-444444444444" };
      process.env.RUDRA_FIELD_ACTIVE_KEY_ID = "field-old";
      const historicalField = encryptOperationalData({ note: "Synthetic historical key recovery value" }, fieldContext);
      process.env.RUDRA_FIELD_ACTIVE_KEY_ID = env.RUDRA_FIELD_ACTIVE_KEY_ID;
      const encryptedField = encryptOperationalData({ note: "Synthetic encrypted recovery value" }, fieldContext);
      const backup = await encryptKeyBackup(collectEncryptionKeyMaterial(env), passphrase);
      const recovered = await decryptKeyBackup(backup, passphrase);

      for (const name of names) delete process.env[name];
      await expect(readReportPdf(reportStorageKey)).rejects.toThrow("report_encryption_key_unavailable");
      expect(() => decryptOperationalData(encryptedField, fieldContext)).toThrow("operational_encryption_key_unavailable");

      for (const [name, value] of Object.entries(recovered.keys)) process.env[name] = value;
      expect(await readReportPdf(reportStorageKey)).toEqual(reportBytes);
      expect(await readReportPdf(historicalReportStorageKey)).toEqual(reportBytes);
      expect(decryptOperationalData(encryptedField, fieldContext)).toEqual({ note: "Synthetic encrypted recovery value" });
      expect(decryptOperationalData(historicalField, fieldContext)).toEqual({ note: "Synthetic historical key recovery value" });
    } finally {
      for (const [name, value] of Object.entries(prior)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await Promise.all([removeReportPdf(reportStorageKey), removeReportPdf(historicalReportStorageKey)]);
    }
  });

  it("rejects wrong passphrases, modified ciphertext, and unsupported formats", async () => {
    const backup = await encryptKeyBackup(collectEncryptionKeyMaterial(env), passphrase);
    await expect(decryptKeyBackup(backup, "different synthetic passphrase" )).rejects.toThrow("backup_authentication_failed");
    const tampered = { ...backup, ciphertext: `${backup.ciphertext[0] === "A" ? "B" : "A"}${backup.ciphertext.slice(1)}` };
    await expect(decryptKeyBackup(tampered, passphrase)).rejects.toThrow("backup_authentication_failed");
    await expect(decryptKeyBackup({ ...backup, format: "unknown" }, passphrase)).rejects.toThrow("backup_format_invalid");
  });

  it("fails closed for incomplete or inconsistent key configuration", () => {
    expect(() => collectEncryptionKeyMaterial({ ...env, RUDRA_FIELD_ACTIVE_KEY_ID: "missing" })).toThrow("backup_active_key_missing");
    expect(() => collectEncryptionKeyMaterial({ ...env, RUDRA_BLIND_INDEX_KEY: "not-a-key" })).toThrow("backup_key_configuration_invalid");
  });

  it("writes a new encrypted backup outside the repository and refuses overwrite", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "rudra-key-backup-")); directories.add(directory);
    const destination = path.join(directory, "synthetic-keys.enc");
    const envelope = await encryptKeyBackup(collectEncryptionKeyMaterial(env), passphrase);
    await writeNewKeyBackup(destination, envelope);
    expect(await readKeyBackup(destination)).toEqual(envelope);
    await expect(writeNewKeyBackup(destination, envelope)).rejects.toMatchObject({ code: "EEXIST" });
    await expect(writeNewKeyBackup(path.join(path.dirname(fileURLToPath(import.meta.url)), "should-not-write.enc"), envelope)).rejects.toThrow("backup_destination_must_be_outside_project");
  });

  it("rejects backup paths redirected into the repository through a directory junction", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "rudra-key-junction-")); directories.add(directory);
    const linkedProject = path.join(directory, "project-link");
    await symlink(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."), linkedProject, "junction");
    const envelope = await encryptKeyBackup(collectEncryptionKeyMaterial(env), passphrase);
    await expect(writeNewKeyBackup(path.join(linkedProject, "redirected.enc"), envelope)).rejects.toThrow("backup_destination_must_be_outside_project");
    await expect(readKeyBackup(path.join(linkedProject, "README.md"))).rejects.toThrow("backup_source_must_be_outside_project");
  });

  it("restores only encryption key variables into an isolated ignored-env fixture", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "rudra-key-recovery-")); directories.add(directory);
    const target = path.join(directory, ".env.local");
    await writeFile(target, "DATABASE_URL=postgresql://synthetic\nRUDRA_FIELD_ACTIVE_KEY_ID=stale\nRUDRA_FIELD_ACTIVE_KEY_ID=duplicate\nCUSTOM_SETTING=keep\n", "utf8");
    const recovered = await decryptKeyBackup(await encryptKeyBackup(collectEncryptionKeyMaterial(env), passphrase), passphrase);
    await mergeRecoveredKeysIntoLocalEnv(target, recovered, { projectRoot: directory });
    const restoredText = await readFile(target, "utf8");
    expect(restoredText).toContain("DATABASE_URL=postgresql://synthetic");
    expect(restoredText).toContain("CUSTOM_SETTING=keep");
    expect(restoredText.match(/^RUDRA_FIELD_ACTIVE_KEY_ID=/gm)).toHaveLength(1);
    expect(restoredText).toContain(`RUDRA_FIELD_ACTIVE_KEY_ID=${env.RUDRA_FIELD_ACTIVE_KEY_ID}`);
    expect(restoredText).toContain(`REPORT_DOCUMENT_ENCRYPTION_KEYS=${env.REPORT_DOCUMENT_ENCRYPTION_KEYS}`);
    expect(restoredText).not.toContain("stale");
    expect(restoredText).not.toContain("duplicate");
  });

  it("refuses recovery targets other than the designated local env file", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "rudra-key-target-")); directories.add(directory);
    const recovered = collectEncryptionKeyMaterial(env);
    await expect(mergeRecoveredKeysIntoLocalEnv(path.join(directory, ".env"), recovered, { projectRoot: directory })).rejects.toThrow("restore_target_must_be_ignored_local_env");
  });

  it("refuses to read and replace a symlink at the ignored-env restore target", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "rudra-key-env-link-")); directories.add(directory);
    const external = path.join(directory, "external");
    const target = path.join(directory, ".env.local");
    await mkdir(external);
    const externalFile = path.join(external, "keep.env");
    await writeFile(externalFile, "KEEP=synthetic\n", "utf8");
    await symlink(external, target, "junction");
    const recovered = collectEncryptionKeyMaterial(env);
    await expect(mergeRecoveredKeysIntoLocalEnv(target, recovered, { projectRoot: directory })).rejects.toThrow("restore_target_must_be_regular_file");
    expect(await readFile(externalFile, "utf8")).toBe("KEEP=synthetic\n");
  });
});
