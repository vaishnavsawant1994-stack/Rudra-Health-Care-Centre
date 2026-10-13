-- Organization-scoped corporate accounts with explicit centre ownership.
BEGIN;

CREATE TABLE corporates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  public_id text NOT NULL,
  centre_id uuid NOT NULL,
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 180),
  industry text CHECK (industry IS NULL OR length(trim(industry)) <= 120),
  contact_name text CHECK (contact_name IS NULL OR length(trim(contact_name)) <= 180),
  contact_title text CHECK (contact_title IS NULL OR length(trim(contact_title)) <= 120),
  contact_mobile_ciphertext bytea,
  contact_mobile_lookup_hash bytea,
  contact_mobile_mask text,
  contact_email_ciphertext bytea,
  billing_terms text CHECK (billing_terms IS NULL OR length(trim(billing_terms)) <= 1000),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','CLOSED')),
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
  CHECK ((contact_mobile_ciphertext IS NULL) = (contact_mobile_lookup_hash IS NULL)),
  CHECK ((contact_mobile_ciphertext IS NULL) = (contact_mobile_mask IS NULL))
);
CREATE UNIQUE INDEX corporates_name_per_centre ON corporates (organization_id, centre_id, lower(name));
CREATE INDEX corporates_centre_status ON corporates (organization_id, centre_id, status, lower(name));

ALTER TABLE patients ADD CONSTRAINT patients_corporate_centre_fk
  FOREIGN KEY (organization_id, corporate_id, primary_centre_id)
  REFERENCES corporates(organization_id, id, centre_id);
ALTER TABLE patients ADD CONSTRAINT patients_corporate_requires_centre
  CHECK (corporate_id IS NULL OR primary_centre_id IS NOT NULL);
CREATE INDEX patients_corporate ON patients (organization_id, corporate_id)
  WHERE corporate_id IS NOT NULL;

COMMIT;
