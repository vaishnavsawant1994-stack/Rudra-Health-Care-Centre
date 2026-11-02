CREATE TABLE lead_private_data (
  lead_id uuid NOT NULL,
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  payload_ciphertext text,
  phone_blind_index char(64),
  email_blind_index char(64),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_private_data_pk PRIMARY KEY(lead_id),
  CONSTRAINT lead_private_data_scope_fk FOREIGN KEY(lead_id,organization_id,centre_id) REFERENCES leads(id,organization_id,centre_id) ON DELETE RESTRICT,
  CONSTRAINT lead_private_data_phone_index_ck CHECK(phone_blind_index IS NULL OR phone_blind_index ~ '^[0-9a-f]{64}$'),
  CONSTRAINT lead_private_data_email_index_ck CHECK(email_blind_index IS NULL OR email_blind_index ~ '^[0-9a-f]{64}$')
);
CREATE INDEX lead_private_phone_blind_lookup_idx ON lead_private_data(organization_id,centre_id,phone_blind_index);
CREATE INDEX lead_private_email_blind_lookup_idx ON lead_private_data(organization_id,centre_id,email_blind_index);

ALTER TABLE lead_activities ADD COLUMN private_payload_ciphertext text;
ALTER TABLE lead_followups ADD COLUMN outcome_note_ciphertext text;
ALTER TABLE lead_conversions ADD COLUMN identity_evidence_ciphertext text;

-- Permit only the one-time legacy-to-ciphertext backfill on append-only history.
CREATE OR REPLACE FUNCTION prevent_lead_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME = 'lead_activities' THEN
      IF OLD.private_payload_ciphertext IS NULL AND NEW.private_payload_ciphertext IS NOT NULL
         AND (to_jsonb(OLD) - 'private_payload_ciphertext') = (to_jsonb(NEW) - 'private_payload_ciphertext') THEN
        RETURN NEW;
      END IF;
    ELSIF TG_TABLE_NAME = 'lead_conversions' THEN
      IF OLD.identity_evidence_ciphertext IS NULL AND NEW.identity_evidence_ciphertext IS NOT NULL
         AND (to_jsonb(OLD) - 'identity_evidence_ciphertext') = (to_jsonb(NEW) - 'identity_evidence_ciphertext') THEN
        RETURN NEW;
      END IF;
    END IF;
  END IF;
  RAISE EXCEPTION 'lead history is append-only';
END $$;
REVOKE UPDATE, DELETE ON TABLE lead_activities, lead_conversions FROM rudra_dev_app;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app') THEN
    GRANT SELECT,INSERT,UPDATE ON lead_private_data TO rudra_dev_app;
    REVOKE DELETE ON lead_private_data FROM rudra_dev_app;
  END IF;
END $$;

COMMENT ON TABLE lead_private_data IS 'Authenticated encrypted lead contact, name, enquiry and consent evidence fields. Exact phone/email lookup uses scoped keyed HMAC indexes.';
