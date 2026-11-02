import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadProjectEnvironment({ root = projectRoot, environment = process.env } = {}) {
  dotenv.config({ path: path.join(root, ".env.local"), processEnv: environment });
  dotenv.config({ path: path.join(root, ".env"), processEnv: environment });
}
