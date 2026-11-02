import path from "node:path";
import { pathToFileURL } from "node:url";
import { loadProjectEnvironment } from "./load-project-env.mjs";
import { runMigrations } from "./migrate.mjs";
loadProjectEnvironment();
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const url=process.env.DATABASE_MIGRATION_URL;
  if(!url)throw new Error("Local migration credential is not configured.");
  try{const result=await runMigrations(url,"0025_patient_contact_encryption.sql");console.log(`Patient contact encryption preparation applied; ${result.total} migrations discovered.`);}
  catch{console.error("Patient contact encryption preparation failed. No secrets or record values were displayed.");process.exitCode=1;}
}
