import { spawnSync } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const TEST_DATABASE = "rudra_health_test";
const TEST_SCHEMA_PREFIX = "p2_09a_";

export function assertDisposableTestUrl(connectionString) {
  let url;
  try { url = new URL(connectionString); } catch { throw new Error("recovery_test_database_url_invalid"); }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (!/^postgres(?:ql)?:$/.test(url.protocol) || database !== TEST_DATABASE) throw new Error("recovery_requires_dedicated_test_database");
  return url;
}

export async function resolvePostgresTools({ platform = process.platform, environment = process.env } = {}) {
  const extension = platform === "win32" ? ".exe" : "";
  const candidates = [];
  if (environment.PG_BIN_DIR) candidates.push(environment.PG_BIN_DIR);
  if (platform === "win32") {
    for (const root of [environment.ProgramFiles, environment["ProgramFiles(x86)"]].filter(Boolean)) {
      const base = path.join(root, "PostgreSQL");
      try {
        const versions = (await readdir(base, { withFileTypes: true })).filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name)).sort((a, b) => Number(b.name) - Number(a.name));
        candidates.push(...versions.map((entry) => path.join(base, entry.name, "bin")));
      } catch { /* optional local PostgreSQL installation */ }
    }
  }
  for (const directory of candidates) {
    const pgDump = path.join(directory, `pg_dump${extension}`);
    const psql = path.join(directory, `psql${extension}`);
    const dumpVersion = spawnSync(pgDump, ["--version"], { encoding: "utf8", windowsHide: true });
    const psqlVersion = spawnSync(psql, ["--version"], { encoding: "utf8", windowsHide: true });
    if (!dumpVersion.error && dumpVersion.status === 0 && !psqlVersion.error && psqlVersion.status === 0) {
      return { pgDump, psql, pgDumpVersion: dumpVersion.stdout.trim(), psqlVersion: psqlVersion.stdout.trim() };
    }
  }
  if (platform !== "win32") {
    const dumpVersion = spawnSync("pg_dump", ["--version"], { encoding: "utf8" });
    const psqlVersion = spawnSync("psql", ["--version"], { encoding: "utf8" });
    if (dumpVersion.status === 0 && psqlVersion.status === 0) return { pgDump: "pg_dump", psql: "psql", pgDumpVersion: dumpVersion.stdout.trim(), psqlVersion: psqlVersion.stdout.trim() };
  }
  return null;
}

export function restrictedToolEnvironment(connectionString, environment = process.env) {
  const url = assertDisposableTestUrl(connectionString);
  const allowed = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "HOME"]) if (environment[key]) allowed[key] = environment[key];
  allowed.PGHOST = decodeURIComponent(url.hostname);
  if (url.port) allowed.PGPORT = url.port;
  allowed.PGDATABASE = decodeURIComponent(url.pathname.replace(/^\//, ""));
  if (url.username) allowed.PGUSER = decodeURIComponent(url.username);
  if (url.password) allowed.PGPASSWORD = decodeURIComponent(url.password);
  for (const [query, variable] of [["sslmode", "PGSSLMODE"], ["sslrootcert", "PGSSLROOTCERT"], ["sslcert", "PGSSLCERT"], ["sslkey", "PGSSLKEY"]]) {
    const value = url.searchParams.get(query);
    if (value) allowed[variable] = value;
  }
  return allowed;
}

export async function protectRecoveryDirectory(directory, { platform = process.platform, environment = process.env } = {}) {
  if (platform !== "win32") return;
  const account = `${environment.USERDOMAIN ?? ""}\\${environment.USERNAME ?? ""}`.replace(/^\\/, "");
  if (!account || account === "\\") throw new Error("recovery_acl_identity_unavailable");
  const result = spawnSync("icacls.exe", [directory, "/inheritance:r", "/grant:r", `${account}:(OI)(CI)F`, "NT AUTHORITY\\SYSTEM:(OI)(CI)F", "*S-1-5-32-544:(OI)(CI)F", "/T", "/C"], { encoding: "utf8", windowsHide: true });
  if (result.error || result.status !== 0) throw new Error("recovery_acl_failed");
}

function validateSchemaName(name) {
  if (typeof name !== "string" || !new RegExp(`^${TEST_SCHEMA_PREFIX}[a-z0-9_]{4,60}$`).test(name)) throw new Error("recovery_schema_not_disposable");
}

function runTool(executable, args, env, input) {
  const result = spawnSync(executable, args, { env, input, encoding: "utf8", maxBuffer: 128 * 1024 * 1024, timeout: 180_000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error(`recovery_tool_failed:${path.basename(executable)}:${result.status ?? "spawn"}`);
  return result.stdout;
}

export async function backupSchema({ connectionString, schema, backupPath, tools }) {
  assertDisposableTestUrl(connectionString);
  validateSchemaName(schema);
  if (!tools?.pgDump) throw new Error("recovery_pg_dump_unavailable");
  const env = restrictedToolEnvironment(connectionString);
  runTool(tools.pgDump, ["--format=plain", "--no-owner", "--no-acl", `--schema=${schema}`, `--file=${backupPath}`], env);
  const dump = await readFile(backupPath, "utf8");
  if (!dump.includes(schema)) throw new Error("recovery_backup_schema_missing");
  return dump;
}

export async function restoreSchema({ connectionString, sourceSchema, destinationSchema, backupSql, restorePath, tools }) {
  assertDisposableTestUrl(connectionString);
  validateSchemaName(sourceSchema); validateSchemaName(destinationSchema);
  if (sourceSchema === destinationSchema) throw new Error("recovery_schema_names_must_differ");
  if (!tools?.psql) throw new Error("recovery_psql_unavailable");
  const occurrences = backupSql.split(sourceSchema).length - 1;
  if (occurrences === 0) throw new Error("recovery_backup_schema_missing");
  const restoredSql = backupSql.split(sourceSchema).join(destinationSchema);
  await writeFile(restorePath, restoredSql, { encoding: "utf8", flag: "wx" });
  runTool(tools.psql, ["--no-psqlrc", "--set=ON_ERROR_STOP=1", `--file=${restorePath}`], restrictedToolEnvironment(connectionString));
  return { sourceSchemaReferencesRemapped: occurrences };
}
