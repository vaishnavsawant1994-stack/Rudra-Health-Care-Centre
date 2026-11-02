import { z } from "zod";

const environmentSchema = z.object({
  DATABASE_URL: z.string().url().refine((value) => value.startsWith("postgres://") || value.startsWith("postgresql://"), "Must be a PostgreSQL connection URL"),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
});
const databaseUrlSchema = environmentSchema.shape.DATABASE_URL;

export type PhaseOneEnvironment = z.infer<typeof environmentSchema>;

export const requiredRuntimeVariables = [
  "DATABASE_URL",
  "BETTER_AUTH_SECRET",
  "BETTER_AUTH_URL",
] as const;

export function parsePhaseOneEnvironment(source: NodeJS.ProcessEnv | Record<string, string | undefined>) {
  const result = environmentSchema.safeParse(source);
  if (result.success) return { ready: true as const, value: result.data, missing: [] as string[], invalid: [] as string[] };

  const issues = result.error.issues;
  const missing = [...new Set(issues.filter((issue) => issue.code === "invalid_type" && issue.input === undefined).map((issue) => String(issue.path[0])))];
  const invalid = [...new Set(issues.filter((issue) => !missing.includes(String(issue.path[0]))).map((issue) => String(issue.path[0])))];
  return { ready: false as const, missing, invalid };
}

export function getPhaseOneEnvironment() {
  const result = parsePhaseOneEnvironment(process.env);
  return result.ready ? result.value : null;
}

export function getDatabaseUrl(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
  const result = databaseUrlSchema.safeParse(source.DATABASE_URL);
  return result.success ? result.data : null;
}

export function isLocalHttpUrl(value: string) {
  try {
    const url = new URL(value);
    return url.protocol === "http:" && ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function getSetupStatus(source: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env) {
  const parsed = parsePhaseOneEnvironment(source);
  return {
    ready: parsed.ready,
    missing: parsed.missing,
    invalid: parsed.invalid,
    secureCookieMode: parsed.ready ? !isLocalHttpUrl(parsed.value.BETTER_AUTH_URL) : null,
    databaseConfigured: Boolean(source.DATABASE_URL),
    authenticationConfigured: parsed.ready,
  };
}
