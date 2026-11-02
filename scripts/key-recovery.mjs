import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { lstat, open, readFile, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadProjectEnvironment } from "./load-project-env.mjs";

const scrypt = promisify(scryptCallback);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FORMAT = "rudra-encryption-key-backup-v1";
const AAD = Buffer.from("rudra:local-encryption-key-backup:v1");
const SCRYPT = Object.freeze({ N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 });
export const KEY_VARIABLES = Object.freeze([
  "REPORT_DOCUMENT_ACTIVE_KEY_ID",
  "REPORT_DOCUMENT_ENCRYPTION_KEYS",
  "RUDRA_FIELD_ACTIVE_KEY_ID",
  "RUDRA_FIELD_ENCRYPTION_KEYS",
  "RUDRA_BLIND_INDEX_KEY",
]);

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

async function assertOutsideProject(candidate, kind) {
  const projectPath = await realpath(root);
  const parentPath = await realpath(path.dirname(candidate));
  const canonicalCandidate = path.join(parentPath, path.basename(candidate));
  if (isWithin(projectPath, canonicalCandidate)) throw new Error(`${kind}_must_be_outside_project`);
  return canonicalCandidate;
}

function assertPassphrase(passphrase) {
  if (typeof passphrase !== "string" || Buffer.byteLength(passphrase, "utf8") < 16 || Buffer.byteLength(passphrase, "utf8") > 1024) {
    throw new Error("backup_passphrase_length_invalid");
  }
}

function validateKeyring(raw, activeId) {
  if (typeof raw !== "string" || typeof activeId !== "string" || !/^[A-Za-z0-9_-]{1,64}$/.test(activeId)) throw new Error("backup_key_configuration_invalid");
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error("backup_key_configuration_invalid"); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length < 1 || Object.keys(parsed).length > 32) throw new Error("backup_key_configuration_invalid");
  for (const [id, encoded] of Object.entries(parsed)) {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(id) || typeof encoded !== "string") throw new Error("backup_key_configuration_invalid");
    const key = Buffer.from(encoded, "base64");
    if (key.length !== 32 || key.toString("base64") !== encoded) throw new Error("backup_key_configuration_invalid");
    key.fill(0);
  }
  if (!Object.hasOwn(parsed, activeId)) throw new Error("backup_active_key_missing");
  return parsed;
}

export function collectEncryptionKeyMaterial(environment = process.env) {
  const documentKeys = validateKeyring(environment.REPORT_DOCUMENT_ENCRYPTION_KEYS, environment.REPORT_DOCUMENT_ACTIVE_KEY_ID);
  const fieldKeys = validateKeyring(environment.RUDRA_FIELD_ENCRYPTION_KEYS, environment.RUDRA_FIELD_ACTIVE_KEY_ID);
  const blind = typeof environment.RUDRA_BLIND_INDEX_KEY === "string" ? Buffer.from(environment.RUDRA_BLIND_INDEX_KEY, "base64") : Buffer.alloc(0);
  if (blind.length !== 32 || blind.toString("base64") !== environment.RUDRA_BLIND_INDEX_KEY) throw new Error("backup_key_configuration_invalid");
  blind.fill(0);
  return {
    format: FORMAT,
    keys: {
      REPORT_DOCUMENT_ACTIVE_KEY_ID: environment.REPORT_DOCUMENT_ACTIVE_KEY_ID,
      REPORT_DOCUMENT_ENCRYPTION_KEYS: JSON.stringify(documentKeys),
      RUDRA_FIELD_ACTIVE_KEY_ID: environment.RUDRA_FIELD_ACTIVE_KEY_ID,
      RUDRA_FIELD_ENCRYPTION_KEYS: JSON.stringify(fieldKeys),
      RUDRA_BLIND_INDEX_KEY: environment.RUDRA_BLIND_INDEX_KEY,
    },
  };
}

export async function encryptKeyBackup(material, passphrase) {
  assertPassphrase(passphrase);
  const validated = validateMaterial(material);
  const salt = randomBytes(16);
  const nonce = randomBytes(12);
  const key = await scrypt(passphrase, salt, 32, SCRYPT);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    cipher.setAAD(AAD);
    const ciphertext = Buffer.concat([cipher.update(JSON.stringify(validated), "utf8"), cipher.final()]);
    return {
      format: FORMAT,
      kdf: { name: "scrypt", N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
      cipher: "aes-256-gcm",
      salt: salt.toString("base64url"),
      nonce: nonce.toString("base64url"),
      tag: cipher.getAuthTag().toString("base64url"),
      ciphertext: ciphertext.toString("base64url"),
    };
  } finally { key.fill(0); }
}

export async function decryptKeyBackup(envelope, passphrase) {
  assertPassphrase(passphrase);
  if (!envelope || envelope.format !== FORMAT || envelope.cipher !== "aes-256-gcm" || envelope.kdf?.name !== "scrypt" || envelope.kdf.N !== SCRYPT.N || envelope.kdf.r !== SCRYPT.r || envelope.kdf.p !== SCRYPT.p) throw new Error("backup_format_invalid");
  const salt = decode(envelope.salt, 16), nonce = decode(envelope.nonce, 12), tag = decode(envelope.tag, 16), ciphertext = decode(envelope.ciphertext, null);
  if (ciphertext.length < 2 || ciphertext.length > 64 * 1024) throw new Error("backup_format_invalid");
  const key = await scrypt(passphrase, salt, 32, SCRYPT);
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce, { authTagLength: 16 });
    decipher.setAAD(AAD); decipher.setAuthTag(tag);
    let material;
    try { material = JSON.parse(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8")); }
    catch { throw new Error("backup_authentication_failed"); }
    return validateMaterial(material);
  } finally { key.fill(0); }
}

function decode(value, expectedLength) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("backup_format_invalid");
  const decoded = Buffer.from(value, "base64url");
  if (decoded.toString("base64url") !== value || (expectedLength !== null && decoded.length !== expectedLength)) throw new Error("backup_format_invalid");
  return decoded;
}

function validateMaterial(material) {
  if (!material || material.format !== FORMAT || !material.keys || typeof material.keys !== "object" || Array.isArray(material.keys)) throw new Error("backup_payload_invalid");
  const entries = Object.keys(material.keys).sort();
  if (entries.length !== KEY_VARIABLES.length || entries.some((name, index) => name !== [...KEY_VARIABLES].sort()[index])) throw new Error("backup_payload_invalid");
  const validated = collectEncryptionKeyMaterial(material.keys);
  return validated;
}

export function serializeKeyBackup(envelope) { return `${JSON.stringify(envelope, null, 2)}\n`; }

export async function writeNewKeyBackup(destination, envelope) {
  const filePath = await assertOutsideProject(path.resolve(destination), "backup_destination");
  if (path.extname(filePath).toLowerCase() !== ".enc") throw new Error("backup_extension_invalid");
  const handle = await open(filePath, "wx", 0o600);
  try { await handle.writeFile(serializeKeyBackup(envelope), { encoding: "utf8" }); await handle.sync(); }
  catch (error) { await handle.close().catch(() => {}); await rm(filePath, { force: true }).catch(() => {}); throw error; }
  await handle.close();
  return filePath;
}

export async function readKeyBackup(filePath) {
  const resolved = await realpath(path.resolve(filePath));
  const projectPath = await realpath(root);
  if (isWithin(projectPath, resolved)) throw new Error("backup_source_must_be_outside_project");
  const info = await stat(resolved);
  if (!info.isFile() || info.size < 100 || info.size > 128 * 1024) throw new Error("backup_file_invalid");
  let parsed;
  try { parsed = JSON.parse(await readFile(resolved, "utf8")); } catch { throw new Error("backup_file_invalid"); }
  return parsed;
}

export async function mergeRecoveredKeysIntoLocalEnv(environmentFile, material, { projectRoot = root } = {}) {
  const canonicalProjectRoot = await realpath(projectRoot);
  const filePath = path.resolve(environmentFile);
  if (filePath !== path.join(canonicalProjectRoot, ".env.local")) throw new Error("restore_target_must_be_ignored_local_env");
  try {
    const existingTarget = await lstat(filePath);
    if (existingTarget.isSymbolicLink() || !existingTarget.isFile()) throw new Error("restore_target_must_be_regular_file");
  } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const validated = validateMaterial(material);
  let existing = "";
  try { existing = await readFile(filePath, "utf8"); } catch (error) { if (error?.code !== "ENOENT") throw error; }
  const lines = existing.split(/\r?\n/);
  const replacements = new Map(Object.entries(validated.keys).map(([name, value]) => [name, `${name}=${value}`]));
  const seen = new Set();
  const merged = [];
  for (const line of lines) {
    const match = /^\s*(REPORT_DOCUMENT_ACTIVE_KEY_ID|REPORT_DOCUMENT_ENCRYPTION_KEYS|RUDRA_FIELD_ACTIVE_KEY_ID|RUDRA_FIELD_ENCRYPTION_KEYS|RUDRA_BLIND_INDEX_KEY)\s*=/.exec(line);
    if (!match) { merged.push(line); continue; }
    const name = match[1];
    if (seen.has(name)) continue;
    seen.add(name); merged.push(replacements.get(name));
  }
  for (const [name, line] of replacements) if (!seen.has(name)) merged.push(line);
  const content = `${merged.filter((line, index, list) => line !== "" || index < list.length - 1).join("\n").replace(/\n*$/, "\n")}`;
  const temporary = path.join(projectRoot, `.env.local.restore-${process.pid}-${randomBytes(6).toString("hex")}.tmp`);
  const handle = await open(temporary, "wx", 0o600);
  try { await handle.writeFile(content, { encoding: "utf8" }); await handle.sync(); }
  catch (error) { await handle.close().catch(() => {}); await rm(temporary, { force: true }).catch(() => {}); throw error; }
  await handle.close();
  try { await rename(temporary, filePath); }
  catch (error) { await rm(temporary, { force: true }).catch(() => {}); throw error; }
}

async function promptSecret(label) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") throw new Error("interactive_terminal_required");
  return new Promise((resolve, reject) => {
    const input = process.stdin;
    let value = "";
    process.stdout.write(`${label}: `);
    const finish = (error) => {
      input.off("data", onData); input.setRawMode(false); input.pause(); process.stdout.write("\n");
      if (error) reject(error); else resolve(value);
    };
    const onData = (chunk) => {
      for (const byte of chunk) {
        if (byte === 3) return finish(new Error("operation_cancelled"));
        if (byte === 13 || byte === 10) return finish();
        if (byte === 8 || byte === 127) { if (value.length) { value = value.slice(0, -1); process.stdout.write("\b \b"); } continue; }
        if (byte < 32 || byte > 126) { process.stdout.write("\u0007"); continue; }
        value += String.fromCharCode(byte); process.stdout.write("*");
      }
    };
    input.setRawMode(true); input.resume(); input.on("data", onData);
  });
}

function constantTimeEqual(left, right) {
  const a = Buffer.from(left, "utf8"), b = Buffer.from(right, "utf8");
  const equal = a.length === b.length && timingSafeEqual(a.length === b.length ? a : Buffer.alloc(Math.max(a.length, b.length)), b.length === a.length ? b : Buffer.alloc(Math.max(a.length, b.length)));
  a.fill(0); b.fill(0); return equal;
}

async function cli() {
  loadProjectEnvironment();
  if (process.env.NODE_ENV === "production") throw new Error("production_key_recovery_disabled");
  const dbUrl = new URL(process.env.DATABASE_URL ?? "");
  const authUrl = new URL(process.env.BETTER_AUTH_URL ?? "");
  if (!/^(rudra_health_dev|rudra_health_test)$/.test(decodeURIComponent(dbUrl.pathname.slice(1))) || !["127.0.0.1", "localhost", "[::1]"].includes(dbUrl.hostname) || !["127.0.0.1", "localhost", "[::1]"].includes(authUrl.hostname)) throw new Error("local_development_environment_required");
  const [command, file, flag] = process.argv.slice(2);
  if (command === "backup") {
    if (!file) throw new Error("usage: keys:backup -- <absolute-path-outside-project>.enc");
    const material = collectEncryptionKeyMaterial(process.env);
    const first = await promptSecret("Choose a 16+ character ASCII recovery passphrase (store separately)");
    const second = await promptSecret("Confirm recovery passphrase");
    if (!constantTimeEqual(first, second)) throw new Error("backup_passphrase_confirmation_mismatch");
    const envelope = await encryptKeyBackup(material, first);
    await writeNewKeyBackup(file, envelope);
    process.stdout.write("Encrypted Rudra key backup created. Keep its passphrase separately; this file alone cannot restore keys.\n");
    return;
  }
  if (command === "restore") {
    if (!file || (flag !== undefined && flag !== "--write-env")) throw new Error("usage: keys:restore -- <backup.enc> [--write-env]");
    const envelope = await readKeyBackup(file);
    const passphrase = await promptSecret("Recovery passphrase");
    const material = await decryptKeyBackup(envelope, passphrase);
    if (flag === "--write-env") {
      process.stdout.write("This will replace only Rudra encryption key variables in the ignored .env.local. Type RESTORE-LOCAL-KEYS to confirm: ");
      const confirmation = await new Promise((resolve) => { process.stdin.setEncoding("utf8"); process.stdin.resume(); process.stdin.once("data", (value) => resolve(value.trim())); });
      if (confirmation !== "RESTORE-LOCAL-KEYS") throw new Error("restore_confirmation_required");
      await mergeRecoveredKeysIntoLocalEnv(path.join(root, ".env.local"), material);
      process.stdout.write("Encryption keys restored to ignored .env.local. Restart Rudra services before use.\n");
      return;
    }
    process.stdout.write("Encrypted backup authenticated and key configuration validated; no files were changed.\n");
    return;
  }
  throw new Error("usage: keys:backup | keys:restore");
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try { await cli(); }
  catch (error) { process.stderr.write(`${error instanceof Error && /^[a-z0-9_-]{1,80}$/.test(error.message) ? error.message : "key_recovery_operation_failed"}\n`); process.exitCode = 1; }
}
