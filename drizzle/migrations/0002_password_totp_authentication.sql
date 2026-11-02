ALTER TABLE "user"
  ADD COLUMN "twoFactorEnabled" boolean NOT NULL DEFAULT false;

CREATE TABLE "twoFactor" (
  id text PRIMARY KEY,
  secret text NOT NULL,
  "backupCodes" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  verified boolean NOT NULL DEFAULT true,
  "failedVerificationCount" integer NOT NULL DEFAULT 0 CHECK ("failedVerificationCount" >= 0),
  "lockedUntil" timestamptz,
  CONSTRAINT two_factor_user_uq UNIQUE ("userId")
);

CREATE INDEX two_factor_secret_idx ON "twoFactor"(secret);
