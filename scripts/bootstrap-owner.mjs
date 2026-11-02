import { randomUUID, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { hashPassword } from "better-auth/crypto";
import { computeAuditEventHash, GENESIS_AUDIT_HASH } from "../src/server/audit-format.mjs";
import { mayBootstrapOwner } from "../src/server/bootstrap-policy.mjs";
import { loadProjectEnvironment } from "./load-project-env.mjs";

loadProjectEnvironment();
const { Pool } = pg;
const CONFIRMATION = "CREATE RUDRA OWNER";
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function ask(rl, prompt) {
  return new Promise((resolve) => rl.question(prompt, (answer) => resolve(answer.trim())));
}

function askHidden(prompt) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") throw new Error("Run owner bootstrap in an interactive VS Code terminal; passwords must be entered without echo.");
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let value = "";
    const wasRaw = input.isRaw;
    const finish = (error) => {
      input.off("data", onData);
      input.setRawMode(wasRaw ?? false);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolve(value);
    };
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") return finish(new Error("Owner bootstrap cancelled."));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) value += character;
      }
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

function sameSecret(first, second) {
  const left = Buffer.from(first, "utf8");
  const right = Buffer.from(second, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function isLocalDevelopmentDatabase(connectionString) {
  try {
    const url = new URL(connectionString);
    return ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && decodeURIComponent(url.pathname.slice(1)) === "rudra_health_dev";
  } catch {
    return false;
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !isLocalDevelopmentDatabase(databaseUrl)) throw new Error("Owner bootstrap is limited to the local rudra_health_dev database.");
  const readline = await import("node:readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  let password;
  let confirmationPassword;
  try {
    const confirmation = await ask(rl, `This one-time command can create the first owner in the empty local development database. Type ${CONFIRMATION} to authorize: `);
    if (!mayBootstrapOwner({ authorized: confirmation === CONFIRMATION, databaseRecordCount: 0 })) throw new Error("Owner bootstrap was not explicitly authorized.");
    const organizationName = await ask(rl, "Rudra organization name: ");
    const organizationCode = (await ask(rl, "Organization code (for example RHC): ")).toUpperCase();
    const centreName = await ask(rl, "Initial centre name: ");
    const centreCode = (await ask(rl, "Initial centre code (for example RHC-CEN-001): ")).toUpperCase();
    const ownerName = await ask(rl, "Owner display name: ");
    const ownerEmail = (await ask(rl, "Owner sign-in email: ")).toLowerCase();
    password = await askHidden("Create owner password (12–128 characters, hidden): ");
    confirmationPassword = await askHidden("Re-enter owner password (hidden): ");
    if (password.length < 12 || password.length > 128 || !sameSecret(password, confirmationPassword)) throw new Error("Owner password did not meet the requirements or did not match.");
    if (!organizationName || !ownerName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail) || !/^[A-Z0-9-]{2,32}$/.test(organizationCode) || !/^[A-Z0-9-]{2,32}$/.test(centreCode)) throw new Error("Organization, centre, or owner details are invalid.");

    const passwordHash = await hashPassword(password);
    const catalog = JSON.parse(await readFile(path.join(projectRoot, "src/server/permission-catalog.json"), "utf8"));
    const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-health-os-owner-bootstrap" });
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(741220251, 2)");
      const existing = await client.query(`SELECT
        (SELECT count(*)::int FROM organizations) AS organizations,
        (SELECT count(*)::int FROM staff_users) AS staff,
        (SELECT count(*)::int FROM "user") AS users,
        (SELECT count(*)::int FROM "account") AS accounts,
        (SELECT count(*)::int FROM external_identities) AS identities`);
      const databaseRecordCount = Object.values(existing.rows[0]).reduce((total, rowCount) => total + rowCount, 0);
      if (!mayBootstrapOwner({ authorized: confirmation === CONFIRMATION, databaseRecordCount })) throw new Error("Owner bootstrap is allowed only once on a clean database.");

      const orgId = randomUUID();
      const centreId = randomUUID();
      const authUserId = randomUUID();
      const authAccountId = randomUUID();
      const staffUserId = randomUUID();
      const roleIds = new Map();
      const permissionIds = new Map();

      await client.query("INSERT INTO organizations (id, code, name, legal_name) VALUES ($1, $2, $3, $3)", [orgId, organizationCode, organizationName]);
      await client.query("INSERT INTO centres (id, organization_id, code, name) VALUES ($1, $2, $3, $4)", [centreId, orgId, centreCode, centreName]);
      await client.query("INSERT INTO organization_sequences (organization_id, next_staff_number) VALUES ($1, 2)", [orgId]);
      await client.query('INSERT INTO "user" (id, name, email, "emailVerified", "twoFactorEnabled") VALUES ($1, $2, $3, false, false)', [authUserId, ownerName, ownerEmail]);
      await client.query('INSERT INTO "account" (id, "accountId", "providerId", "userId", password) VALUES ($1, $2, \'credential\', $3, $4)', [authAccountId, authUserId, authUserId, passwordHash]);
      await client.query("INSERT INTO staff_users (id, auth_user_id, organization_id, staff_code, display_name, status, is_owner) VALUES ($1, $2, $3, 'RHC-STF-000001', $4, 'ACTIVE', true)", [staffUserId, authUserId, orgId, ownerName]);

      for (const [key, description, scope] of catalog.permissions) {
        const id = randomUUID();
        permissionIds.set(key, id);
        await client.query("INSERT INTO permissions (id, key, description, scope) VALUES ($1, $2, $3, $4)", [id, key, description, scope]);
      }
      for (const [key, name, scope] of catalog.roles) {
        const id = randomUUID();
        roleIds.set(key, id);
        await client.query("INSERT INTO roles (id, organization_id, key, name, scope, is_system) VALUES ($1, $2, $3, $4, $5, true)", [id, orgId, key, name, scope]);
        for (const permission of catalog.roleGrants[key] ?? []) {
          await client.query("INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)", [id, permissionIds.get(permission)]);
        }
      }
      await client.query("INSERT INTO staff_role_assignments (organization_id, staff_user_id, role_id, centre_id, assigned_by_staff_id) VALUES ($1, $2, $3, NULL, $2)", [orgId, staffUserId, roleIds.get("owner_super_admin")]);

      const audit = {
        id: randomUUID(), organizationId: orgId, centreId: null, actorStaffId: staffUserId,
        action: "owner.bootstrap.completed", entityType: "organization", entityId: orgId,
        details: { initialCentreCount: 1, authentication: "password_totp_required", version: "phase01" }, recordedAt: new Date(),
      };
      const eventHash = computeAuditEventHash(audit, GENESIS_AUDIT_HASH);
      await client.query("INSERT INTO audit_events (id, organization_id, centre_id, actor_staff_id, action, entity_type, entity_id, details, previous_hash, event_hash, recorded_at) VALUES ($1, $2, NULL, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)", [audit.id, orgId, staffUserId, audit.action, audit.entityType, audit.entityId, JSON.stringify(audit.details), GENESIS_AUDIT_HASH, eventHash, audit.recordedAt]);
      await client.query("COMMIT");
      console.log("First owner created in the local development database. Sign in and finish authenticator enrollment before opening the owner dashboard.");
    } catch {
      await client.query("ROLLBACK").catch(() => undefined);
      throw new Error("Owner bootstrap did not complete. The database was left unchanged; inspect its state before retrying.");
    } finally {
      client.release();
      await pool.end();
    }
  } finally {
    rl.close();
  }
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Owner bootstrap did not complete.");
  process.exitCode = 1;
}
