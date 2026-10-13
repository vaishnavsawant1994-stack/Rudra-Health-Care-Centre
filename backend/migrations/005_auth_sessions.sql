-- Rudra Health OS R1.1: opaque browser sessions for OIDC-authenticated staff.
-- The identity provider remains the authority for credentials and MFA.
BEGIN;

CREATE TABLE auth_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  token_hash bytea NOT NULL UNIQUE,
  csrf_hash bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  replaced_by_session_id uuid REFERENCES auth_sessions(id),
  ip_address inet,
  user_agent text,
  FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id),
  CHECK (expires_at > created_at),
  CHECK (absolute_expires_at >= expires_at)
);
CREATE INDEX auth_sessions_user_active ON auth_sessions (organization_id, user_id, expires_at)
  WHERE revoked_at IS NULL;
CREATE INDEX auth_sessions_expiry ON auth_sessions (expires_at)
  WHERE revoked_at IS NULL;

CREATE INDEX users_active_identity ON users (organization_id, auth_subject)
  WHERE status = 'active';

COMMIT;
