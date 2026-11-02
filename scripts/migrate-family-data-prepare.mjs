import { loadProjectEnvironment } from "./load-project-env.mjs";
import { runMigrations } from "./migrate.mjs";
loadProjectEnvironment();
const url = process.env.DATABASE_MIGRATION_URL;
if (!url) throw new Error("Local migration credential is not configured.");
try { const result = await runMigrations(url, "0031_family_sensitive_encryption_prepare.sql"); console.log(`Family sensitive-data encryption preparation applied; ${result.total} migrations discovered.`); }
catch { console.error("Family encryption preparation failed. No connection secrets were displayed."); process.exitCode = 1; }
