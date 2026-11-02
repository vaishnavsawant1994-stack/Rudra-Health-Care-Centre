ALTER TABLE appointments ADD COLUMN private_data_ciphertext text;
ALTER TABLE appointment_services ADD COLUMN private_data_ciphertext text;
ALTER TABLE appointment_status_history ADD COLUMN private_data_ciphertext text;
ALTER TABLE appointment_assignment_history ADD COLUMN private_data_ciphertext text;
ALTER TABLE collection_job_events ADD COLUMN private_data_ciphertext text;
ALTER TABLE specimens ADD COLUMN private_data_ciphertext text;
ALTER TABLE dispatch_batches ADD COLUMN private_data_ciphertext text;
ALTER TABLE sample_custody_events ADD COLUMN private_data_ciphertext text;
ALTER TABLE sample_external_receipts ADD COLUMN private_data_ciphertext text;
ALTER TABLE sample_exceptions ADD COLUMN private_data_ciphertext text;

-- Allow a one-time ciphertext fill for immutable histories while preserving every original field.
CREATE OR REPLACE FUNCTION prevent_appointment_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.private_data_ciphertext IS NULL AND NEW.private_data_ciphertext IS NOT NULL
       AND (to_jsonb(OLD) - 'private_data_ciphertext') = (to_jsonb(NEW) - 'private_data_ciphertext') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'appointment history is append-only';
END $$;

CREATE OR REPLACE FUNCTION sample_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF TG_TABLE_NAME IN ('collection_job_events', 'sample_custody_events', 'sample_external_receipts')
       AND OLD.private_data_ciphertext IS NULL AND NEW.private_data_ciphertext IS NOT NULL
       AND (to_jsonb(OLD) - 'private_data_ciphertext') = (to_jsonb(NEW) - 'private_data_ciphertext') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'sample history is append-only';
END $$;

COMMENT ON COLUMN appointments.private_data_ciphertext IS 'Authenticated encrypted address, instructions, consent evidence and home charge reason.';
COMMENT ON COLUMN sample_custody_events.private_data_ciphertext IS 'Authenticated encrypted custody evidence and operational reason; event identity/order remain relational.';
