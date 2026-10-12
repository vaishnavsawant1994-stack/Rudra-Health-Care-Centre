BEGIN;
CREATE TABLE patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  public_id text NOT NULL,
  first_name text NOT NULL,
  middle_name text,
  last_name text,
  date_of_birth date,
  gender text,
  mobile_ciphertext bytea,
  mobile_lookup_hash bytea,
  mobile_mask text,
  alternate_mobile_ciphertext bytea,
  email_ciphertext bytea,
  preferred_language text,
  primary_centre_id uuid,
  referral_source text,
  referred_doctor_id uuid,
  corporate_id uuid,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE','DECEASED','BLOCKED','MERGED')),
  is_primary_account_holder boolean NOT NULL DEFAULT false,
  notes_summary text,
  last_visit_at timestamptz,
  merged_into_patient_id uuid REFERENCES patients(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  updated_by uuid REFERENCES users(id),
  deleted_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, public_id),
  FOREIGN KEY (organization_id, primary_centre_id) REFERENCES centres(organization_id, id),
  CHECK ((status = 'MERGED') = (merged_into_patient_id IS NOT NULL))
);
CREATE INDEX patients_mobile_lookup ON patients (organization_id, mobile_lookup_hash) WHERE deleted_at IS NULL;
CREATE INDEX patients_public_id ON patients (organization_id, public_id);
CREATE INDEX patients_name_lookup ON patients (organization_id, lower(last_name), lower(first_name)) WHERE deleted_at IS NULL;
CREATE TABLE patient_addresses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  label text NOT NULL DEFAULT 'HOME',
  address_line_1 text NOT NULL,
  address_line_2 text,
  landmark text,
  city text NOT NULL,
  state text NOT NULL,
  postal_code text NOT NULL,
  country text NOT NULL DEFAULT 'India',
  latitude numeric(9,6),
  longitude numeric(9,6),
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patients(organization_id, id)
);
CREATE UNIQUE INDEX one_primary_patient_address ON patient_addresses (organization_id, patient_id) WHERE is_primary;
CREATE TABLE patient_external_identifiers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  provider text NOT NULL,
  identifier_type text NOT NULL,
  external_identifier_ciphertext bytea NOT NULL,
  external_identifier_hash bytea NOT NULL,
  display_mask text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patients(organization_id, id),
  UNIQUE (organization_id, provider, identifier_type, external_identifier_hash)
);
CREATE TABLE patient_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  name text NOT NULL,
  description text,
  UNIQUE (organization_id, id)
);
CREATE UNIQUE INDEX patient_tags_name_unique ON patient_tags (organization_id, lower(name));
CREATE TABLE patient_tag_assignments (
  organization_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  tag_id uuid NOT NULL,
  assigned_by uuid NOT NULL REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (patient_id, tag_id),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patients(organization_id, id),
  FOREIGN KEY (organization_id, tag_id) REFERENCES patient_tags(organization_id, id)
);
CREATE TABLE family_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  related_patient_id uuid NOT NULL,
  relationship_type text NOT NULL CHECK (relationship_type IN ('SPOUSE','MOTHER','FATHER','SON','DAUGHTER','CHILD','SIBLING','GUARDIAN','OTHER')),
  is_primary_contact boolean NOT NULL DEFAULT false,
  valid_from date NOT NULL DEFAULT CURRENT_DATE,
  valid_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL REFERENCES users(id),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patients(organization_id, id),
  FOREIGN KEY (organization_id, related_patient_id) REFERENCES patients(organization_id, id),
  CHECK (patient_id <> related_patient_id),
  CHECK (valid_until IS NULL OR valid_until >= valid_from)
);
CREATE INDEX family_by_patient ON family_relationships (organization_id, patient_id, valid_until);
COMMIT;
