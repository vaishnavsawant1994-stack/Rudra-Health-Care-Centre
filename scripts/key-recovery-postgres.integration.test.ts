import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";
import { loadProjectEnvironment } from "./load-project-env.mjs";
import { runMigrations } from "./migrate.mjs";
import { collectEncryptionKeyMaterial, decryptKeyBackup, encryptKeyBackup } from "./key-recovery.mjs";
import { openWebsiteContent, sealWebsiteContent } from "../src/server/website-content";
import { persistReportPdf, readReportPdf, removeReportPdf, safeReportStorageKey } from "../src/server/report-storage";
import { blindIndexPatientContact, blindIndexPatientName, decryptPatientContacts, decryptPatientIdentity, encryptPatientContacts, encryptPatientIdentity } from "../src/server/patient-contact-crypto";

const { Pool } = pg;
const passphrase = "synthetic-postgres-recovery-drill-passphrase";
const keyNames = [
  "REPORT_DOCUMENT_ACTIVE_KEY_ID", "REPORT_DOCUMENT_ENCRYPTION_KEYS",
  "RUDRA_FIELD_ACTIVE_KEY_ID", "RUDRA_FIELD_ENCRYPTION_KEYS", "RUDRA_BLIND_INDEX_KEY",
] as const;

describe("encrypted PostgreSQL and report recovery qualification", () => {
  const schema = `p2_09a_key_restore_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  const savedEnvironment = new Map(keyNames.map((name) => [name, process.env[name]]));
  const reportStorageKey = safeReportStorageKey();
  let testUrl = "";
  let pool: InstanceType<typeof Pool> | undefined;
  let admin: InstanceType<typeof Pool> | undefined;

  beforeAll(async () => {
    loadProjectEnvironment();
    testUrl = process.env.DATABASE_TEST_URL ?? "";
    if (!testUrl || !/^postgres(?:ql)?:\/\//i.test(testUrl) || !/test/i.test(decodeURIComponent(new URL(testUrl).pathname))) {
      throw new Error("A dedicated PostgreSQL test database is required for key recovery qualification.");
    }

    const keyset = makeSyntheticKeyset();
    for (const [name, value] of Object.entries(keyset)) process.env[name] = value;
    admin = new Pool({ connectionString: testUrl, max: 1, application_name: "rudra-synthetic-key-recovery-setup" });
    await admin.query(`CREATE SCHEMA "${schema}"`);
    await runMigrations(testUrl, null, schema);
    const scopedUrl = new URL(testUrl);
    scopedUrl.searchParams.set("options", `-csearch_path=${schema},public`);
    pool = new Pool({ connectionString: scopedUrl.toString(), max: 1, application_name: "rudra-synthetic-key-recovery-test" });
  }, 120_000);

  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`).catch(() => undefined);
      await admin.end();
    }
    await removeReportPdf(reportStorageKey).catch(() => undefined);
    for (const [name, value] of savedEnvironment) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }, 30_000);

  it("restores keys needed to decrypt populated encrypted rows and private report files", async () => {
    expect(pool).toBeDefined();
    const organizationId = randomUUID();
    const centreId = randomUUID();
    const staffId = randomUUID();
    const authId = randomUUID();
    const pageId = randomUUID();
    const patientId = randomUUID();
    const pageContent = {
      title: "Synthetic recovery page",
      summary: "Synthetic encrypted database payload",
      sections: [{ heading: "Test section", body: "Synthetic PostgreSQL recovery value" }],
    };
    const ciphertext = sealWebsiteContent(organizationId, pageId, pageContent);

    await pool!.query("INSERT INTO organizations(id,code,name) VALUES($1,$2,$3)", [organizationId, `KR-${organizationId.slice(0, 8)}`, "Synthetic recovery organization"]);
    await pool!.query("INSERT INTO centres(id,organization_id,code,name) VALUES($1,$2,$3,$4)", [centreId, organizationId, `KR-${centreId.slice(0, 8)}`, "Synthetic recovery centre"]);
    await pool!.query('INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)', [authId, "Synthetic Recovery Staff", `${authId}@invalid.test`]);
    await pool!.query("INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',true)", [staffId, authId, organizationId, `ST-${staffId.slice(0, 8)}`, "Synthetic Recovery Staff"]);
    await pool!.query("INSERT INTO patients(id,organization_id,centre_id,patient_number,consent_status,consent_recorded_at,consent_method,created_by_staff_id) VALUES($1,$2,$3,$4,'NOT_RECORDED',NULL,NULL,$5)", [patientId, organizationId, centreId, `SYN-P-${patientId.slice(0, 8)}`, staffId]);
    await pool!.query(
      "INSERT INTO website_content_pages(id,organization_id,slug,draft_ciphertext,draft_version,created_by_staff_id,updated_by_staff_id) VALUES($1,$2,'home',$3,1,$4,$4)",
      [pageId, organizationId, ciphertext, staffId],
    );
    const patientContext = { organizationId, centreId, patientId };
    const contacts = encryptPatientContacts({ phone: "+919876543210", email: "synthetic.patient@invalid.test", profile: { preferredName: "Synthetic", dateOfBirth: "1990-01-01", sexAtRegistration: "UNSPECIFIED", address: { city: "Synthetic City" } } }, patientContext);
    const identity = encryptPatientIdentity({ firstName: "Synthetic", lastName: "Patient" }, patientContext);
    await pool!.query(
      "INSERT INTO patient_contact_secrets(patient_id,organization_id,centre_id,encryption_key_id,phone_ciphertext,email_ciphertext,profile_ciphertext,name_ciphertext,phone_blind_index,email_blind_index,first_name_blind_index,last_name_blind_index,full_name_blind_index) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)",
      [patientId, organizationId, centreId, contacts.encryptionKeyId, contacts.phoneCiphertext, contacts.emailCiphertext, contacts.profileCiphertext, identity.nameCiphertext, contacts.phoneBlindIndex, contacts.emailBlindIndex, identity.firstNameBlindIndex, identity.lastNameBlindIndex, identity.fullNameBlindIndex],
    );
    const reportBytes = Buffer.from("%PDF-1.4\n% Synthetic encrypted recovery fixture\n%%EOF\n", "utf8");
    await persistReportPdf(reportStorageKey, reportBytes);

    const stored = await pool!.query("SELECT draft_ciphertext FROM website_content_pages WHERE id=$1", [pageId]);
    const storedPatient = await pool!.query("SELECT * FROM patient_contact_secrets WHERE patient_id=$1", [patientId]);
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].draft_ciphertext).not.toContain("Synthetic PostgreSQL recovery value");
    expect(stored.rows[0].draft_ciphertext).toBe(ciphertext);
    expect(storedPatient.rows).toHaveLength(1);
    expect(JSON.stringify(storedPatient.rows[0])).not.toContain("+919876543210");
    const patientRecord = {
      encryptionKeyId: storedPatient.rows[0].encryption_key_id,
      phoneCiphertext: storedPatient.rows[0].phone_ciphertext,
      emailCiphertext: storedPatient.rows[0].email_ciphertext,
      profileCiphertext: storedPatient.rows[0].profile_ciphertext,
      nameCiphertext: storedPatient.rows[0].name_ciphertext,
    };
    const contactIndex = blindIndexPatientContact("phone", "+919876543210");
    const nameIndex = blindIndexPatientName("full", "Synthetic Patient");
    expect(storedPatient.rows[0].phone_blind_index.trim()).toBe(contactIndex);
    expect(storedPatient.rows[0].full_name_blind_index.trim()).toBe(nameIndex);

    const backup = await encryptKeyBackup(collectEncryptionKeyMaterial(process.env), passphrase);
    const recovered = await decryptKeyBackup(backup, passphrase);
    for (const name of keyNames) delete process.env[name];
    expect(() => openWebsiteContent(organizationId, pageId, stored.rows[0].draft_ciphertext)).toThrow("operational_encryption_key_unavailable");
    expect(() => blindIndexPatientContact("phone", "+919876543210")).toThrow("patient_blind_index_key_unavailable");
    await expect(readReportPdf(reportStorageKey)).rejects.toThrow("report_encryption_key_unavailable");

    for (const [name, value] of Object.entries(recovered.keys)) process.env[name] = value;
    expect(openWebsiteContent(organizationId, pageId, stored.rows[0].draft_ciphertext)).toEqual(pageContent);
    expect(blindIndexPatientContact("phone", "+919876543210")).toBe(storedPatient.rows[0].phone_blind_index.trim());
    expect(blindIndexPatientName("full", "Synthetic Patient")).toBe(storedPatient.rows[0].full_name_blind_index.trim());
    expect(decryptPatientContacts(patientRecord, patientContext)).toMatchObject({ phone: "+919876543210", email: "synthetic.patient@invalid.test" });
    expect(decryptPatientIdentity(patientRecord, patientContext)).toEqual({ firstName: "Synthetic", lastName: "Patient" });
    expect(await readReportPdf(reportStorageKey)).toEqual(reportBytes);
  }, 30_000);
});

function makeSyntheticKeyset() {
  const base64 = () => randomBytes(32).toString("base64");
  return {
    REPORT_DOCUMENT_ACTIVE_KEY_ID: "synthetic-report-recovery-current",
    REPORT_DOCUMENT_ENCRYPTION_KEYS: JSON.stringify({ "synthetic-report-recovery-current": base64() }),
    RUDRA_FIELD_ACTIVE_KEY_ID: "synthetic-field-recovery-current",
    RUDRA_FIELD_ENCRYPTION_KEYS: JSON.stringify({ "synthetic-field-recovery-current": base64() }),
    RUDRA_BLIND_INDEX_KEY: base64(),
  };
}
