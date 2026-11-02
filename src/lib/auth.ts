import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { twoFactor } from "better-auth/plugins";
import { randomUUID } from "node:crypto";
import { getPhaseOneEnvironment } from "@/lib/phase-one-config";
import { getDb } from "@/db/client";
import { authSchema } from "@/db/auth-schema";

export const STAFF_SESSION_POLICY = { expiresIn: 60 * 60 * 8, updateAge: 60 * 10, freshAge: 60 * 10 } as const;
export const PASSWORD_POLICY = { minPasswordLength: 12, maxPasswordLength: 128 } as const;
export const PASSWORD_AUTH_POLICY = { enabled: true, disableSignUp: true, ...PASSWORD_POLICY, autoSignIn: false } as const;
export const TWO_FACTOR_ENFORCEMENT_POLICY = { trustDeviceMaxAge: 0, skipVerificationOnEnable: false } as const;
export const AUTH_ID_GENERATOR = () => randomUUID();
export const REDACTED_AUTH_LOGGER = {
  level: "error" as const,
  log: (..._details: unknown[]) => console.error("[Better Auth] Internal authentication error (details redacted)."),
};

export function secureCookiePolicy(authUrl: string) {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: !/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?\/?$/i.test(authUrl),
    path: "/" as const,
  };
}

export function buildAuthOptions(env: NonNullable<ReturnType<typeof getPhaseOneEnvironment>>) {
  return {
    appName: "Rudra Health Care Centre",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.BETTER_AUTH_SECRET,
    database: drizzleAdapter(getDb(), { provider: "pg", schema: authSchema }),
    trustedOrigins: [env.BETTER_AUTH_URL],
    logger: REDACTED_AUTH_LOGGER,
    emailAndPassword: PASSWORD_AUTH_POLICY,
    account: { accountLinking: { enabled: false } },
    session: {
      ...STAFF_SESSION_POLICY,
      additionalFields: {
        mfaVerifiedAt: { type: "date", required: false, input: false, returned: false },
      },
    },
    rateLimit: {
      enabled: true,
      storage: "database" as const,
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 10 },
        "/two-factor/verify-backup-code": { window: 60, max: 5 },
      },
    },
    advanced: {
      // Auth tables use text IDs. Better Auth's built-in "uuid" mode assumes
      // the database supplies UUID defaults; this project intentionally keeps
      // auth IDs as text, so generate UUID strings in the application.
      database: { generateId: AUTH_ID_GENERATOR },
      cookiePrefix: "rudra",
      defaultCookieAttributes: secureCookiePolicy(env.BETTER_AUTH_URL),
    },
    plugins: [twoFactor({
      issuer: "Rudra Health Care Centre",
      ...TWO_FACTOR_ENFORCEMENT_POLICY,
      allowPasswordless: false,
      accountLockout: { enabled: true, maxFailedAttempts: 5, durationSeconds: 15 * 60 },
      backupCodeOptions: { amount: 10, length: 12, storeBackupCodes: "encrypted" },
    })],
  };
}

let authInstance: ReturnType<typeof betterAuth> | undefined;

export function getAuth() {
  const env = getPhaseOneEnvironment();
  if (!env) return null;
  if (!authInstance) authInstance = betterAuth(buildAuthOptions(env) as BetterAuthOptions) as unknown as ReturnType<typeof betterAuth>;
  return authInstance;
}
