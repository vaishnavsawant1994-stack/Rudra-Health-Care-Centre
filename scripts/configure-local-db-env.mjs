import { randomBytes, randomUUID } from "node:crypto";
import { access, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import dotenv from "dotenv";
import pg from "pg";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(projectRoot, ".env.local");
const { Pool } = pg;

export const LOCAL_DATABASES = [
  { envKey: "DATABASE_MIGRATION_URL", role: "rudra_dev_migrator", database: "rudra_health_dev", ownsDatabase: true, canCreateSchema: true },
  { envKey: "DATABASE_URL", role: "rudra_dev_app", database: "rudra_health_dev", ownsDatabase: false, canCreateSchema: false },
  { envKey: "DATABASE_TEST_URL", role: "rudra_test_runner", database: "rudra_health_test", ownsDatabase: true, canCreateSchema: true },
];

export function buildLocalConnectionUrl({ role, database, password }) {
  const url = new URL(`postgresql://127.0.0.1:5432/${database}`);
  const encodeUserInfo = (value) => encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
  url.username = encodeUserInfo(role);
  url.password = encodeUserInfo(password);
  return url.toString();
}

export function inspectConnectionTarget(connectionUrl, expected) {
  try {
    const url = new URL(connectionUrl);
    const username = decodeURIComponent(url.username);
    return {
      valid: url.protocol === "postgres:" || url.protocol === "postgresql:",
      local: ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname),
      expectedRole: username === expected.role,
      expectedDatabase: decodeURIComponent(url.pathname.slice(1)) === expected.database,
    };
  } catch {
    return { valid: false, local: false, expectedRole: false, expectedDatabase: false };
  }
}

export function mergeLocalEnvironment(existingText, updates) {
  const lines = existingText ? existingText.replace(/\r\n/g, "\n").split("\n") : [];
  for (const [key, value] of Object.entries(updates)) {
    const assignment = `${key}=${value}`;
    const index = lines.findIndex((line) => line.startsWith(`${key}=`));
    if (index === -1) lines.push(assignment);
    else lines[index] = assignment;
  }
  return `${lines.filter((line, index, all) => index < all.length - 1 || line !== "").join("\n").replace(/\n*$/, "")}\n`;
}

export function isLocalListenAddress(value) {
  const addresses = String(value).split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  return addresses.length > 0 && addresses.every((entry) => ["localhost", "127.0.0.1", "::1"].includes(entry));
}

export function readConfiguredListenAddress(mainConfig, autoConfig = "") {
  const readSetting = (text) => {
    const matches = [...String(text).matchAll(/^\s*listen_addresses\s*=\s*(['"])(.*?)\1\s*(?:#.*)?$/gim)];
    return matches.length ? matches[matches.length - 1][2].trim() : null;
  };
  return readSetting(autoConfig) ?? readSetting(mainConfig) ?? "*";
}

function hasUsableSecret(value) {
  return typeof value === "string" && value.length > 0 && !/CHANGE_ME|replace-with/i.test(value);
}

function setPrivateAcl(filePath) {
  const currentAccount = `${process.env.USERDOMAIN ?? ""}\\${process.env.USERNAME ?? ""}`.replace(/^\\/, "");
  if (!currentAccount || currentAccount === "\\") throw new Error("Could not determine the current Windows account for local file protection.");
  const result = spawnSync("icacls.exe", [
    filePath,
    "/inheritance:r",
    "/grant:r",
    `${currentAccount}:(F)`,
    "NT AUTHORITY\\SYSTEM:(F)",
    "*S-1-5-32-544:(F)",
  ], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error("Could not apply private Windows file permissions to .env.local.");
}

async function promptHidden(prompt) {
  const input = process.stdin;
  if (!input.isTTY || typeof input.setRawMode !== "function") throw new Error("Run this command from an interactive VS Code terminal to enter passwords without echo.");
  process.stdout.write(prompt);
  return new Promise((resolve, reject) => {
    let value = "";
    const oldRaw = input.isRaw;
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") return finish(new Error("Local database setup cancelled."));
        if (character === "\r" || character === "\n") return finish();
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127) value += character;
      }
    };
    const finish = (error) => {
      input.off("data", onData);
      input.setRawMode(oldRaw ?? false);
      process.stdout.write("\n");
      if (error) reject(error);
      else if (!value) reject(new Error("Password input was empty."));
      else resolve(value);
    };
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}

async function readEnvFile() {
  try {
    await access(envPath);
    const text = await readFile(envPath, "utf8");
    return { text, parsed: dotenv.parse(text) };
  } catch (error) {
    if (error?.code === "ENOENT") return { text: "", parsed: {} };
    throw new Error("Could not read .env.local; no configuration was changed.", { cause: error });
  }
}

async function ensureConfiguredLocalListener() {
  const dataDirectory = "C:\\Program Files\\PostgreSQL\\17\\data";
  const config = await (async () => {
    try {
      const main = await readFile(path.join(dataDirectory, "postgresql.conf"), "utf8");
      const automatic = await readFile(path.join(dataDirectory, "postgresql.auto.conf"), "utf8").catch((error) => {
        if (error?.code === "ENOENT") return "";
        throw error;
      });
      return { main, automatic };
    } catch {
      throw new Error("Could not verify PostgreSQL listener settings. No passwords were requested and .env.local was not changed.");
    }
  })();
  const configured = readConfiguredListenAddress(config.main, config.automatic);
  if (!isLocalListenAddress(configured)) {
    throw new Error("PostgreSQL is configured to listen beyond localhost. In authenticated SQL Shell as postgres, run ALTER SYSTEM SET listen_addresses = 'localhost', restart the PostgreSQL service, and rerun this setup. No passwords were requested and .env.local was not changed.");
  }
}

async function verifyRole(connectionUrl, expected) {
  const target = inspectConnectionTarget(connectionUrl, expected);
  if (!target.valid || !target.local || !target.expectedRole || !target.expectedDatabase) {
    throw new Error(`Configured connection does not match the expected local role/database for ${expected.role}.`);
  }
  const pool = new Pool({ connectionString: connectionUrl, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-local-db-setup" });
  try {
    const result = await pool.query(`
      SELECT current_user AS role, current_database() AS database,
             r.rolsuper AS superuser, r.rolcreatedb AS can_create_database,
             r.rolcreaterole AS can_create_roles,
             d.datdba = r.oid AS owns_database,
             has_schema_privilege(current_user, 'public', 'USAGE') AS can_use_schema,
             has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_schema,
             current_setting('listen_addresses') AS listen_addresses
      FROM pg_roles r JOIN pg_database d ON d.datname = current_database()
      WHERE r.rolname = current_user
    `);
    const row = result.rows[0];
    if (!row || row.role !== expected.role || row.database !== expected.database) throw new Error("Connected PostgreSQL identity did not match the requested role/database.");
    if (row.superuser || row.can_create_database || row.can_create_roles) throw new Error(`Role ${expected.role} has unexpected cluster-level privileges.`);
    if (row.owns_database !== expected.ownsDatabase || row.can_create_schema !== expected.canCreateSchema || !row.can_use_schema) {
      throw new Error(`Role ${expected.role} has unexpected database/schema privileges.`);
    }
    return { role: row.role, database: row.database, listenAddresses: row.listen_addresses };
  } catch {
    throw new Error(`Could not verify ${expected.role} against ${expected.database}. Check the password and provisioning grants; no secrets were logged.`);
  } finally {
    await pool.end();
  }
}

async function writeProtectedEnv(text) {
  const temporaryPath = path.join(projectRoot, `.env.local.${randomUUID()}.tmp`);
  try {
    await writeFile(temporaryPath, "", { flag: "wx", encoding: "utf8" });
    setPrivateAcl(temporaryPath);
    await writeFile(temporaryPath, text, { encoding: "utf8" });
    await rename(temporaryPath, envPath);
    setPrivateAcl(envPath);
  } catch {
    await unlink(temporaryPath).catch(() => undefined);
    throw new Error("Could not safely write protected .env.local; existing settings were not intentionally changed.");
  }
}

export async function configureLocalDatabaseEnvironment({ prompt = promptHidden, envFile = readEnvFile, writeEnv = writeProtectedEnv } = {}) {
  await ensureConfiguredLocalListener();
  const { text, parsed } = await envFile();
  const urls = {};
  const passwords = [];
  const results = [];
  try {
    for (const expected of LOCAL_DATABASES) {
      let connectionUrl = parsed[expected.envKey];
      if (!hasUsableSecret(connectionUrl)) {
        const password = await prompt(`Password for ${expected.role} (hidden): `);
        passwords.push(password);
        connectionUrl = buildLocalConnectionUrl({ ...expected, password });
      }
      const result = await verifyRole(connectionUrl, expected);
      urls[expected.envKey] = connectionUrl;
      results.push(result);
    }

    const listenAddresses = results[0]?.listenAddresses;
    const localOnly = isLocalListenAddress(listenAddresses);
    if (!localOnly) throw new Error("PostgreSQL runtime settings are not localhost-only. No credentials were written to .env.local.");
    const authSecret = hasUsableSecret(parsed.BETTER_AUTH_SECRET)
      ? parsed.BETTER_AUTH_SECRET
      : randomBytes(48).toString("base64url");
    let reportKeyId=parsed.REPORT_DOCUMENT_ACTIVE_KEY_ID;
    let reportKeyring=parsed.REPORT_DOCUMENT_ENCRYPTION_KEYS;
    if(!reportKeyId&&!reportKeyring){reportKeyId="local-v1";reportKeyring=JSON.stringify({[reportKeyId]:randomBytes(32).toString("base64")});}
    else{
      try{const keys=JSON.parse(reportKeyring??"");if(!reportKeyId||!keys||typeof keys!=="object"||Array.isArray(keys)||!Object.hasOwn(keys,reportKeyId)||Buffer.from(keys[reportKeyId],"base64").length!==32)throw new Error();}
      catch{throw new Error("Report document encryption key configuration is incomplete or invalid; no settings were written.");}
    }
    const updates = {
      DATABASE_URL: urls.DATABASE_URL,
      DATABASE_MIGRATION_URL: urls.DATABASE_MIGRATION_URL,
      DATABASE_TEST_URL: urls.DATABASE_TEST_URL,
      BETTER_AUTH_SECRET: authSecret,
      BETTER_AUTH_URL: hasUsableSecret(parsed.BETTER_AUTH_URL) ? parsed.BETTER_AUTH_URL : "http://localhost:3000",
      REPORT_DOCUMENT_ACTIVE_KEY_ID: reportKeyId,
      REPORT_DOCUMENT_ENCRYPTION_KEYS: reportKeyring,
      ...(() => {
        let activeId=parsed.RUDRA_FIELD_ACTIVE_KEY_ID;
        let fieldKeys=parsed.RUDRA_FIELD_ENCRYPTION_KEYS;
        let blindKey=parsed.RUDRA_BLIND_INDEX_KEY;
        if(!activeId&&!fieldKeys&&!blindKey){activeId="local-v1";fieldKeys=JSON.stringify({[activeId]:randomBytes(32).toString("base64")});blindKey=randomBytes(32).toString("base64");}
        else{try{const keys=JSON.parse(fieldKeys??"");if(!activeId||!blindKey||!keys||typeof keys!=="object"||Array.isArray(keys)||!Object.hasOwn(keys,activeId)||Buffer.from(keys[activeId],"base64").length!==32||Buffer.from(blindKey,"base64").length!==32)throw new Error();}catch{throw new Error("Patient-field encryption key configuration is incomplete or invalid; no settings were written.");}}
        return {RUDRA_FIELD_ACTIVE_KEY_ID:activeId,RUDRA_FIELD_ENCRYPTION_KEYS:fieldKeys,RUDRA_BLIND_INDEX_KEY:blindKey};
      })(),
      RUDRA_BOOTSTRAP_ENABLED: "0",
    };
    await writeEnv(mergeLocalEnvironment(text, updates));
    return { results, localOnly };
  } finally {
    for (let index = 0; index < passwords.length; index++) passwords[index] = "";
    for (const key of Object.keys(urls)) urls[key] = "";
  }
}

async function main() {
  try {
    const result = await configureLocalDatabaseEnvironment();
    for (const connection of result.results) console.log(`Verified ${connection.role} on ${connection.database}.`);
    if (result.localOnly) console.log("PostgreSQL is bound to local interfaces only.");
    else console.warn("Connection settings are protected locally, but PostgreSQL listen_addresses is not localhost-only; hardening remains pending.");
    console.log("Protected .env.local is ready. Passwords and credential URLs were not displayed.");
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Local database setup did not complete.");
    process.exitCode = 1;
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) await main();
