import { loadProjectEnvironment } from "./load-project-env.mjs";
import { runMigrations } from "./migrate.mjs";
loadProjectEnvironment();
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error("Local migration credential is not configured.");
try { const result = await runMigrations(url, "0029_patient_name_encryption_prepare.sql"); console.log(`Patient name encryption preparation applied; ${result.total} migrations discovered.`); }
catch { console.error("Patient name encryption preparation failed. No connection secrets were displayed."); process.exitCode = 1; }
