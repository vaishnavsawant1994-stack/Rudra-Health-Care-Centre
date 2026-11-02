import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { getDatabaseUrl } from "@/lib/phase-one-config";
import * as authSchema from "./auth-schema";
import * as appSchema from "./schema";

const globalForDb = globalThis as typeof globalThis & {
  rudraPool?: Pool;
  rudraDb?: NodePgDatabase<typeof authSchema & typeof appSchema>;
};

export class DatabaseNotConfiguredError extends Error {
  constructor() {
    super("PostgreSQL is not configured.");
    this.name = "DatabaseNotConfiguredError";
  }
}

export function getPool() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) throw new DatabaseNotConfiguredError();
  if (!globalForDb.rudraPool) {
    globalForDb.rudraPool = new Pool({
      connectionString: databaseUrl,
      max: process.env.NODE_ENV === "production" ? 10 : 4,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      application_name: "rudra-health-os",
    });
  }
  return globalForDb.rudraPool;
}

/** Close and clear the process-wide pool so isolated integration schemas do not leak into later tests. */
export async function closeDatabasePool() {
  const pool = globalForDb.rudraPool;
  delete globalForDb.rudraDb;
  delete globalForDb.rudraPool;
  await pool?.end();
}

export function getDb() {
  if (!globalForDb.rudraDb) globalForDb.rudraDb = drizzle(getPool(), { schema: { ...authSchema, ...appSchema } });
  return globalForDb.rudraDb;
}

export async function checkDatabase() {
  try {
    await getPool().query("select 1");
    return { configured: true, available: true };
  } catch {
    return { configured: Boolean(getDatabaseUrl()), available: false };
  }
}
