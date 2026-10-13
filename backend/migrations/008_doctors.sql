-- Centre-scoped referral doctors. Contact and registration identifiers stay encrypted.
BEGIN;

CREATE TABLE doctors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  public_id text NOT NULL,
  centre_id uuid NOT NULL,
  first_name text NOT NULL CHECK (length(trim(first_name)) BETWEEN 1 AND 120),
  last_name text CHECK (last_name IS NULL OR length(trim(last_name)) <= 120),
  specialty text CHECK (specialty IS NULL OR length(trim(specialty)) <= 120),
  qualification text CHECK (qualification IS NULL OR length(trim(qualification)) <= 240),
  registration_ciphertext bytea,
  registration_lookup_hash bytea,
  registration_mask text,
  mobile_ciphertext bytea,
  mobile_lookup_hash bytea,
  mobile_mask text,
  email_ciphertext bytea,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  notes text CHECK (notes IS NULL OR length(notes) <= 4000),
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, id, centre_id),
  UNIQUE (organization_id, public_id),
  FOREIGN KEY (organization_id, centre_id) REFERENCES centres(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id),
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id),
  CHECK ((registration_ciphertext IS NULL) = (registration_lookup_hash IS NULL)),
  CHECK ((registration_ciphertext IS NULL) = (registration_mask IS NULL)),
  CHECK ((mobile_ciphertext IS NULL) = (mobile_lookup_hash IS NULL)),
  CHECK ((mobile_ciphertext IS NULL) = (mobile_mask IS NULL))
);
CREATE UNIQUE INDEX doctors_registration_unique ON doctors (organization_id, registration_lookup_hash)
  WHERE registration_lookup_hash IS NOT NULL;
CREATE INDEX doctors_centre_status ON doctors (organization_id, centre_id, status, lower(first_name), lower(last_name));

ALTER TABLE patients ADD CONSTRAINT patients_referred_doctor_centre_fk
  FOREIGN KEY (organization_id, referred_doctor_id, primary_centre_id)
  REFERENCES doctors(organization_id, id, centre_id);
ALTER TABLE patients ADD CONSTRAINT patients_doctor_requires_centre
  CHECK (referred_doctor_id IS NULL OR primary_centre_id IS NOT NULL);
CREATE INDEX patients_referred_doctor ON patients (organization_id, referred_doctor_id)
  WHERE referred_doctor_id IS NOT NULL;

COMMIT;
