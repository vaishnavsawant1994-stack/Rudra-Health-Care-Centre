CREATE TABLE patient_contact_secrets (
  patient_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  encryption_key_id varchar(48) NOT NULL,
  phone_ciphertext text NOT NULL,
  email_ciphertext text,
  phone_blind_index char(64) NOT NULL,
  email_blind_index char(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_contact_secrets_pk PRIMARY KEY(patient_id),
  CONSTRAINT patient_contact_secrets_scope_fk FOREIGN KEY(patient_id,organization_id,centre_id) REFERENCES patients(id,organization_id,centre_id) ON DELETE RESTRICT,
  CONSTRAINT patient_contact_secrets_key_format CHECK(encryption_key_id ~ '^[A-Za-z0-9_-]{1,48}$'),
  CONSTRAINT patient_contact_secrets_phone_index_format CHECK(phone_blind_index ~ '^[0-9a-f]{64}$'),
  CONSTRAINT patient_contact_secrets_email_index_format CHECK(email_blind_index IS NULL OR email_blind_index ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX patient_contact_phone_blind_uq ON patient_contact_secrets(organization_id,centre_id,phone_blind_index);
CREATE UNIQUE INDEX patient_contact_email_blind_uq ON patient_contact_secrets(organization_id,centre_id,email_blind_index) WHERE email_blind_index IS NOT NULL;
CREATE INDEX patient_contact_scope_idx ON patient_contact_secrets(organization_id,centre_id,patient_id);

ALTER TABLE patients ALTER COLUMN phone DROP NOT NULL;
DROP INDEX patients_phone_lookup_idx;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app') THEN
    GRANT SELECT,INSERT,UPDATE ON patient_contact_secrets TO rudra_dev_app;
    REVOKE DELETE ON patient_contact_secrets FROM rudra_dev_app;
  END IF;
END $$;

COMMENT ON TABLE patient_contact_secrets IS 'Patient phone/email ciphertext and purpose-specific keyed blind indexes. Legacy patients.phone/email remain only during the staged backfill and are removed in a later migration.';
