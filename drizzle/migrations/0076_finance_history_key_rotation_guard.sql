-- Permit controlled ciphertext-only key rotation for append-only finance history.
-- Application roles cannot use this path; only the dedicated local migration
-- roles may set the transaction-local flag, and all other row values stay fixed.
CREATE OR REPLACE FUNCTION finance_history_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE'
     AND TG_TABLE_NAME IN ('finance_events','finance_adjustments','finance_reconciliations')
     AND OLD.private_data_ciphertext IS NOT NULL
     AND NEW.private_data_ciphertext IS NOT NULL
     AND OLD.private_data_ciphertext IS DISTINCT FROM NEW.private_data_ciphertext
     AND (to_jsonb(OLD) - 'private_data_ciphertext') = (to_jsonb(NEW) - 'private_data_ciphertext')
     AND current_user IN ('rudra_dev_migrator','rudra_test_runner')
     AND current_setting('rudra.finance_report_key_rotation', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP='UPDATE'
     AND TG_TABLE_NAME IN ('finance_events','finance_adjustments','finance_reconciliations')
     AND OLD.private_data_ciphertext IS NULL AND NEW.private_data_ciphertext IS NOT NULL
     AND (to_jsonb(OLD) - 'private_data_ciphertext') = (to_jsonb(NEW) - 'private_data_ciphertext') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'financial history is append-only';
END $$;

CREATE OR REPLACE FUNCTION prevent_report_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE'
     AND TG_TABLE_NAME IN ('report_events','report_deliveries','report_followup_events')
     AND OLD.private_data_ciphertext IS NOT NULL
     AND NEW.private_data_ciphertext IS NOT NULL
     AND OLD.private_data_ciphertext IS DISTINCT FROM NEW.private_data_ciphertext
     AND (to_jsonb(OLD) - 'private_data_ciphertext') = (to_jsonb(NEW) - 'private_data_ciphertext')
     AND current_user IN ('rudra_dev_migrator','rudra_test_runner')
     AND current_setting('rudra.finance_report_key_rotation', true) = 'on' THEN
    RETURN NEW;
  END IF;

  IF TG_OP='UPDATE'
     AND TG_TABLE_NAME IN ('report_events','report_deliveries','report_followup_events')
     AND OLD.private_data_ciphertext IS NULL AND NEW.private_data_ciphertext IS NOT NULL
     AND (to_jsonb(OLD) - 'private_data_ciphertext') = (to_jsonb(NEW) - 'private_data_ciphertext') THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'report history is append-only';
END $$;
