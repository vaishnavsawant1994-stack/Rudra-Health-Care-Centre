-- Rudra Health OS R1 / PostgreSQL 15+
-- Organization, centre and public-ID counter foundation.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id text NOT NULL UNIQUE,
  name text NOT NULL,
  legal_name text,
  brand_name text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','closed')),
  default_timezone text NOT NULL DEFAULT 'Asia/Kolkata',
  default_currency char(3) NOT NULL DEFAULT 'INR',
  country_code char(2) NOT NULL DEFAULT 'IN',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0)
);
CREATE TABLE centres (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  public_id text NOT NULL,
  name text NOT NULL,
  centre_type text NOT NULL CHECK (centre_type IN ('MAIN','COLLECTION_CENTRE','SATELLITE','CORPORATE_SITE','MOBILE_COLLECTION','FUTURE_FRANCHISE')),
  phone text,
  email text,
  address_line_1 text NOT NULL,
  address_line_2 text,
  city text NOT NULL,
  state text NOT NULL,
  postal_code text NOT NULL,
  country text NOT NULL DEFAULT 'India',
  latitude numeric(9,6),
  longitude numeric(9,6),
  opening_hours_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  manager_user_id uuid,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, public_id),
  CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);
CREATE TABLE identifier_sequences (
  organization_id uuid NOT NULL REFERENCES organizations(id),
  identifier_kind text NOT NULL,
  period_key text NOT NULL DEFAULT '',
  next_value bigint NOT NULL DEFAULT 1 CHECK (next_value > 0),
  PRIMARY KEY (organization_id, identifier_kind, period_key)
);
COMMIT;
