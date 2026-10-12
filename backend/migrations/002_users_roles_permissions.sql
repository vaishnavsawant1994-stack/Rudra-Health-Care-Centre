-- Credentials stay in the selected identity provider; never store raw passwords here.
BEGIN;
CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  public_id text NOT NULL,
  auth_subject text NOT NULL,
  email text,
  phone text,
  status text NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','locked','disabled')),
  email_verified_at timestamptz,
  phone_verified_at timestamptz,
  last_login_at timestamptz,
  failed_login_count integer NOT NULL DEFAULT 0 CHECK (failed_login_count >= 0),
  locked_until timestamptz,
  mfa_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, public_id),
  UNIQUE (organization_id, auth_subject)
);
CREATE UNIQUE INDEX users_org_email_lower ON users (organization_id, lower(email)) WHERE email IS NOT NULL;
CREATE TABLE staff_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES users(id),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  public_id text NOT NULL,
  first_name text NOT NULL,
  last_name text,
  display_name text NOT NULL,
  employee_code text,
  primary_centre_id uuid,
  manager_staff_id uuid,
  employment_status text NOT NULL DEFAULT 'active' CHECK (employment_status IN ('active','leave','ended')),
  job_title text,
  mobile text,
  profile_image_url text,
  joined_at date,
  left_at date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, public_id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, primary_centre_id) REFERENCES centres(organization_id, id),
  FOREIGN KEY (organization_id, manager_staff_id) REFERENCES staff_profiles(organization_id, id)
);
CREATE TABLE roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  code text NOT NULL,
  name text NOT NULL,
  description text,
  is_system_role boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, code)
);
CREATE TABLE permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  module text NOT NULL,
  action text NOT NULL,
  description text NOT NULL
);
CREATE TABLE role_permissions (
  organization_id uuid NOT NULL,
  role_id uuid NOT NULL,
  permission_id uuid NOT NULL REFERENCES permissions(id),
  allow boolean NOT NULL DEFAULT true,
  PRIMARY KEY (organization_id, role_id, permission_id),
  FOREIGN KEY (organization_id, role_id) REFERENCES roles(organization_id, id)
);
CREATE TABLE user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  role_id uuid NOT NULL,
  centre_id uuid,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  assigned_by uuid NOT NULL REFERENCES users(id),
  UNIQUE NULLS NOT DISTINCT (organization_id, user_id, role_id, centre_id),
  FOREIGN KEY (organization_id, user_id) REFERENCES users(organization_id, id),
  FOREIGN KEY (organization_id, role_id) REFERENCES roles(organization_id, id),
  FOREIGN KEY (organization_id, centre_id) REFERENCES centres(organization_id, id)
);
ALTER TABLE centres ADD CONSTRAINT centres_manager_user_fk FOREIGN KEY (manager_user_id) REFERENCES users(id);
COMMIT;
