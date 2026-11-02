-- Permit privileged, ciphertext-only re-encryption of immutable appointment and
-- custody histories. The application role has no UPDATE grants on these tables.
CREATE OR REPLACE FUNCTION prevent_appointment_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF current_setting('rudra.operational_data_key_rotation', true) = 'on'
       AND OLD.private_data_ciphertext IS DISTINCT FROM NEW.private_data_ciphertext
       AND (to_jsonb(OLD) - 'private_data_ciphertext') = (to_jsonb(NEW) - 'private_data_ciphertext') THEN
      RETURN NEW;
    END IF;
    IF OLD.private_data_ciphertext IS NULL AND NEW.private_data_ciphertext IS NOT NULL
       AND (to_jsonb(OLD) - 'private_data_ciphertext') = (to_jsonb(NEW) - 'private_data_ciphertext') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'appointment history is append-only';
END $$;

CREATE OR REPLACE FUNCTION sample_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME IN ('collection_job_events', 'sample_custody_events', 'sample_external_receipts') THEN
    IF current_setting('rudra.operational_data_key_rotation', true) = 'on'
       AND OLD.private_data_ciphertext IS DISTINCT FROM NEW.private_data_ciphertext
       AND (to_jsonb(OLD) - 'private_data_ciphertext') = (to_jsonb(NEW) - 'private_data_ciphertext') THEN
      RETURN NEW;
    END IF;
    IF OLD.private_data_ciphertext IS NULL AND NEW.private_data_ciphertext IS NOT NULL
       AND (to_jsonb(OLD) - 'private_data_ciphertext') = (to_jsonb(NEW) - 'private_data_ciphertext') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'sample history is append-only';
END $$;
