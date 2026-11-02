-- Migration 0088 predates appointment-arrival and queue-event triggers that
-- reuse the history function but do not have encrypted payload columns. Keep
-- their append-only behavior unchanged while limiting ciphertext exceptions
-- to the two appointment-history tables that actually store private payloads.
CREATE OR REPLACE FUNCTION prevent_appointment_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND TG_TABLE_NAME IN ('appointment_status_history', 'appointment_assignment_history') THEN
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
