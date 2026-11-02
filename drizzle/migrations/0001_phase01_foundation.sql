CREATE TYPE staff_status AS ENUM ('INVITED', 'ACTIVE', 'SUSPENDED', 'REVOKED');
CREATE TYPE role_scope AS ENUM ('ORGANIZATION', 'CENTRE');

CREATE TABLE "user" (
  "id" text PRIMARY KEY,
  "name" text NOT NULL,
  "email" text NOT NULL,
  "emailVerified" boolean NOT NULL DEFAULT false,
  "image" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_email_uq UNIQUE ("email")
);

CREATE TABLE "session" (
  "id" text PRIMARY KEY,
  "expiresAt" timestamptz NOT NULL,
  "token" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  "ipAddress" varchar(128),
  "userAgent" text,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  CONSTRAINT session_token_uq UNIQUE ("token")
);
CREATE INDEX session_user_id_idx ON "session"("userId");

CREATE TABLE "account" (
  "id" text PRIMARY KEY,
  "accountId" text NOT NULL,
  "providerId" text NOT NULL,
  "userId" text NOT NULL REFERENCES "user"("id") ON DELETE CASCADE,
  "accessToken" text,
  "refreshToken" text,
  "idToken" text,
  "accessTokenExpiresAt" timestamptz,
  "refreshTokenExpiresAt" timestamptz,
  "scope" text,
  "password" text,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT account_provider_subject_uq UNIQUE ("providerId", "accountId")
);
CREATE INDEX account_user_id_idx ON "account"("userId");

CREATE TABLE "verification" (
  "id" text PRIMARY KEY,
  "identifier" text NOT NULL,
  "value" text NOT NULL,
  "expiresAt" timestamptz NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now(),
  "updatedAt" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verification_identifier_idx ON "verification"("identifier");

CREATE TABLE "rateLimit" (
  "id" text PRIMARY KEY,
  "key" text NOT NULL,
  "count" integer NOT NULL,
  "lastRequest" bigint NOT NULL,
  CONSTRAINT rate_limit_key_uq UNIQUE ("key")
);

CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code varchar(32) NOT NULL UNIQUE,
  name varchar(180) NOT NULL,
  legal_name varchar(240),
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organizations_id_code_uq UNIQUE (id, code)
);

CREATE TABLE centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  code varchar(32) NOT NULL,
  name varchar(180) NOT NULL,
  address jsonb,
  time_zone varchar(64) NOT NULL DEFAULT 'Asia/Kolkata',
  status varchar(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'SUSPENDED', 'CLOSED')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT centres_org_code_uq UNIQUE (organization_id, code),
  CONSTRAINT centres_id_org_uq UNIQUE (id, organization_id)
);
CREATE INDEX centres_org_idx ON centres(organization_id);

CREATE TABLE staff_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id text NOT NULL REFERENCES "user"(id) ON DELETE RESTRICT UNIQUE,
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  staff_code varchar(32) NOT NULL,
  display_name varchar(180) NOT NULL,
  status staff_status NOT NULL DEFAULT 'INVITED',
  is_owner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_org_code_uq UNIQUE (organization_id, staff_code),
  CONSTRAINT staff_id_org_uq UNIQUE (id, organization_id)
);
CREATE INDEX staff_org_status_idx ON staff_users(organization_id, status);

CREATE TABLE external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_user_id uuid NOT NULL REFERENCES staff_users(id) ON DELETE RESTRICT,
  provider_id varchar(80) NOT NULL,
  issuer text NOT NULL,
  subject text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT external_identity_issuer_subject_uq UNIQUE (issuer, subject),
  CONSTRAINT external_identity_provider_subject_uq UNIQUE (provider_id, subject)
);
CREATE INDEX external_identity_staff_idx ON external_identities(staff_user_id);

CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  key varchar(80) NOT NULL,
  name varchar(120) NOT NULL,
  scope role_scope NOT NULL,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT roles_org_key_uq UNIQUE (organization_id, key),
  CONSTRAINT roles_id_org_uq UNIQUE (id, organization_id)
);

CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key varchar(100) NOT NULL UNIQUE,
  description varchar(240) NOT NULL,
  scope role_scope NOT NULL
);

CREATE TABLE role_permissions (
  role_id uuid NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
  granted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT role_permissions_pk PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE staff_role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  staff_user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  centre_id uuid,
  assigned_by_staff_id uuid REFERENCES staff_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT staff_role_assignment_staff_org_fk FOREIGN KEY (staff_user_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT staff_role_assignment_role_org_fk FOREIGN KEY (role_id, organization_id) REFERENCES roles(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT staff_role_assignment_centre_org_fk FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX staff_role_assignments_staff_idx ON staff_role_assignments(staff_user_id);
CREATE INDEX staff_role_assignments_scope_idx ON staff_role_assignments(centre_id);
CREATE UNIQUE INDEX staff_role_assignment_org_active_uq ON staff_role_assignments(staff_user_id, role_id) WHERE centre_id IS NULL AND revoked_at IS NULL;
CREATE UNIQUE INDEX staff_role_assignment_centre_active_uq ON staff_role_assignments(staff_user_id, role_id, centre_id) WHERE centre_id IS NOT NULL AND revoked_at IS NULL;

CREATE TABLE organization_sequences (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE RESTRICT,
  next_staff_number bigint NOT NULL DEFAULT 1 CHECK (next_staff_number > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE application_configuration (
  key varchar(120) PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by_staff_id uuid REFERENCES staff_users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY UNIQUE NOT NULL,
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES organizations(id) ON DELETE RESTRICT,
  centre_id uuid REFERENCES centres(id) ON DELETE RESTRICT,
  actor_staff_id uuid REFERENCES staff_users(id) ON DELETE RESTRICT,
  action varchar(120) NOT NULL,
  entity_type varchar(80) NOT NULL,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  previous_hash varchar(64) NOT NULL,
  event_hash varchar(64) NOT NULL UNIQUE,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_events_centre_org_fk FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT audit_events_actor_org_fk FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX audit_events_org_seq_idx ON audit_events(organization_id, sequence);

CREATE FUNCTION reject_audit_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = '55000';
END;
$$;
CREATE TRIGGER audit_events_no_update_or_delete
  BEFORE UPDATE OR DELETE ON audit_events
  FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

COMMENT ON TABLE external_identities IS 'Maps a pre-provisioned Rudra staff record to a verified OIDC issuer and immutable subject. Never store provider tokens here.';
COMMENT ON TABLE audit_events IS 'Append-only, hash-chained security and administration history. Runtime roles must not own this table or its trigger.';
