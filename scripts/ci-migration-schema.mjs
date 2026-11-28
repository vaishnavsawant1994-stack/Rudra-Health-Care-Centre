import { randomBytes } from "node:crypto";

/** Return a schema name accepted by the existing P2-09A disposable-backfill guard. */
export function createCiMigrationSchema({ pid = process.pid, suffix = randomBytes(5).toString("hex") } = {}) {
  const schema = `p2_09a_ci_upgrade_${pid}_${suffix}`;
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema) || !/^p2_09a_[a-z0-9_]{1,48}$/.test(schema)
    || !/^p2_09a_ci_upgrade_[0-9]+_[a-f0-9]{10}$/.test(schema)) {
    throw new Error("Invalid disposable CI migration schema name.");
  }
  return schema;
}
