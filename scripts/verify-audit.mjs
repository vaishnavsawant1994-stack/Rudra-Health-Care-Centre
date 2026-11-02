import pg from "pg";
import { verifyAuditChain } from "../src/server/audit-format.mjs";
import { loadProjectEnvironment } from "./load-project-env.mjs";

loadProjectEnvironment();
const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl || !/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
  console.error("DATABASE_URL is not configured. Audit verification did not run.");
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5000, application_name: "rudra-health-os-audit-check" });
try {
  const result = await pool.query(`SELECT id::text AS id, organization_id::text AS "organizationId", centre_id::text AS "centreId", actor_staff_id::text AS "actorStaffId", action, entity_type AS "entityType", entity_id AS "entityId", details, previous_hash AS "previousHash", event_hash AS "eventHash", recorded_at AS "recordedAt" FROM audit_events ORDER BY sequence`);
  const verification = verifyAuditChain(result.rows);
  if (!verification.valid) {
    console.error(`Audit chain verification failed at event ${verification.eventId}.`);
    process.exitCode = 1;
  } else {
    console.log(`Audit chain verified: ${verification.verifiedEvents} event(s).`);
  }
} catch {
  console.error("Audit verification could not complete. Check database availability and schema; connection details were withheld.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
