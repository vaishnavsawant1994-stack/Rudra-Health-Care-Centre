import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { appendFileSync } from "node:fs";
import pg from "pg";
import { hashPassword } from "better-auth/crypto";

// This extends the existing finance browser fixture only on the disposable Actions DB.
const url = process.env.DATABASE_TEST_URL;
if (process.env.GITHUB_ACTIONS !== "true" || process.env.CI !== "true" || !process.env.GITHUB_ENV || !url ||
    url !== process.env.DATABASE_URL || url !== process.env.DATABASE_MIGRATION_URL) {
  throw new Error("role_browser_fixture_requires_disposable_github_actions_database");
}
const parsed = new URL(url);
if (!["127.0.0.1", "localhost"].includes(parsed.hostname) ||
    decodeURIComponent(parsed.pathname) !== "/rudra_health_test") {
  throw new Error("role_browser_fixture_refuses_non_test_database");
}
const catalogue = JSON.parse(await readFile(new URL("../src/server/permission-catalog.json", import.meta.url), "utf8"));
const roleSpecs = [
  { key: "OWNER", name: "Synthetic Owner", catalogRole: "owner_super_admin", isOwner: true },
  { key: "MANAGER", name: "Synthetic Centre Manager", catalogRole: "centre_manager" },
  { key: "RECEPTION", name: "Synthetic Receptionist", catalogRole: "receptionist" },
  { key: "COLLECTOR", name: "Synthetic Field Collector", catalogRole: "phlebotomist" },
  { key: "BRANCH", name: "Synthetic Branch Receiver", catalogRole: "laboratory_branch_operations" },
  { key: "FINANCE", name: "Synthetic Finance Operator", permissions: ["finance.read", "finance.charge.create"] },
  { key: "RESTRICTED", name: "Synthetic Restricted Staff", permissions: ["workspace.read"] },
];
const { Pool } = pg;
const pool = new Pool({ connectionString: url, max: 1, application_name: "rudra-ci-role-browser-fixtures" });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const originalStaffId = process.env.FINANCE_BROWSER_STAFF_ID;
  const centreId = process.env.FINANCE_BROWSER_CENTRE_ID;
  if (!originalStaffId || !centreId) throw new Error("existing_synthetic_finance_fixture_missing");
  const source = await client.query(
    "SELECT s.organization_id FROM staff_users s JOIN centres c ON c.organization_id=s.organization_id AND c.id=$2 WHERE s.id=$1 AND s.status='ACTIVE'",
    [originalStaffId, centreId],
  );
  if (source.rowCount !== 1) throw new Error("existing_synthetic_organization_not_found");
  const organizationId = source.rows[0].organization_id;
  // Owner bootstrap normally installs the canonical permission catalogue. The
  // finance-only fixture did not need every permission, so mirror that bootstrap
  // safely in this isolated test transaction before assigning additional roles.
  for (const [key, description, scope] of catalogue.permissions) {
    await client.query(
      "INSERT INTO permissions(key,description,scope) VALUES($1,$2,$3) ON CONFLICT(key) DO NOTHING",
      [key, description, scope],
    );
  }
  const rolesByKey = new Map(catalogue.roles.map(([key, name, scope]) => [key, { name, scope }]));
  const outputs = {};
  for (const spec of roleSpecs) {
    const catalogEntry = spec.catalogRole ? rolesByKey.get(spec.catalogRole) : null;
    if (spec.catalogRole && !catalogEntry) throw new Error("unknown_synthetic_role_catalogue_key");
    const permissionKeys = spec.permissions ?? catalogue.roleGrants[spec.catalogRole];
    if (!Array.isArray(permissionKeys) || permissionKeys.length === 0 || new Set(permissionKeys).size !== permissionKeys.length) {
      throw new Error("invalid_synthetic_role_grants");
    }
    const known = await client.query("SELECT key FROM permissions WHERE key=ANY($1::text[])", [permissionKeys]);
    if (known.rowCount !== permissionKeys.length) {
      throw new Error("synthetic_role_grants_missing_permission_catalogue_entries:" + spec.key);
    }

    const authId = randomUUID();
    const staffId = randomUUID();
    const roleId = randomUUID();
    const password = "Synthetic-CI-" + randomBytes(24).toString("base64url") + "!";
    const email = "role-" + spec.key.toLowerCase() + "-" + randomUUID().slice(0, 8) + "@invalid.test";
    const passwordHash = await hashPassword(password);
    await client.query(
      'INSERT INTO "user"(id,name,email,"emailVerified") VALUES($1,$2,$3,true)',
      [authId, spec.name, email],
    );
    await client.query(
      'INSERT INTO "account"(id,"accountId","providerId","userId",password) VALUES($1,$2,\'credential\',$3,$4)',
      [randomUUID(), authId, authId, passwordHash],
    );
    await client.query(
      "INSERT INTO staff_users(id,auth_user_id,organization_id,staff_code,display_name,status,is_owner) VALUES($1,$2,$3,$4,$5,'ACTIVE',$6)",
      [staffId, authId, organizationId, "SYN-" + spec.key + "-" + staffId.slice(0, 8), spec.name, Boolean(spec.isOwner)],
    );
    const scope = catalogEntry?.scope ?? "CENTRE";
    await client.query(
      "INSERT INTO roles(id,organization_id,key,name,scope) VALUES($1,$2,$3,$4,$5)",
      [roleId, organizationId, "ci_role_" + spec.key.toLowerCase() + "_" + roleId.slice(0, 8), spec.name, scope],
    );
    const inserted = await client.query(
      "INSERT INTO role_permissions(role_id,permission_id) SELECT $1,id FROM permissions WHERE key=ANY($2::text[]) RETURNING permission_id",
      [roleId, permissionKeys],
    );
    if (inserted.rowCount !== permissionKeys.length) throw new Error("synthetic_role_grant_count_mismatch");
    await client.query(
      "INSERT INTO staff_role_assignments(organization_id,staff_user_id,role_id,centre_id,assigned_by_staff_id) VALUES($1,$2,$3,$4,$5)",
      [organizationId, staffId, roleId, scope === "ORGANIZATION" ? null : centreId, originalStaffId],
    );
    outputs["ROLE_BROWSER_" + spec.key + "_EMAIL"] = email;
    outputs["ROLE_BROWSER_" + spec.key + "_PASSWORD"] = password;
  }
  await client.query("COMMIT");
  for (const [key, value] of Object.entries(outputs)) {
    if (/[\r\n]/.test(value)) throw new Error("invalid_synthetic_browser_env_value");
    if (key.endsWith("_PASSWORD")) process.stdout.write("::add-mask::" + value + "\n");
    appendFileSync(process.env.GITHUB_ENV, key + "=" + value + "\n");
  }
  process.stdout.write("Created seven additional isolated synthetic staff identities with scoped roles.\n");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
