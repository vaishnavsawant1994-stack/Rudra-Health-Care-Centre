CREATE OR REPLACE FUNCTION prevent_lead_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF current_setting('rudra.lead_sensitive_key_rotation', true) = 'on' THEN
      IF TG_TABLE_NAME = 'lead_activities'
         AND (to_jsonb(NEW) -> 'private_payload_ciphertext') IS DISTINCT FROM (to_jsonb(OLD) -> 'private_payload_ciphertext')
         AND (to_jsonb(OLD) - 'private_payload_ciphertext') = (to_jsonb(NEW) - 'private_payload_ciphertext') THEN
        RETURN NEW;
      ELSIF TG_TABLE_NAME = 'lead_conversions'
         AND (to_jsonb(NEW) -> 'identity_evidence_ciphertext') IS DISTINCT FROM (to_jsonb(OLD) -> 'identity_evidence_ciphertext')
         AND (to_jsonb(OLD) - 'identity_evidence_ciphertext') = (to_jsonb(NEW) - 'identity_evidence_ciphertext') THEN
        RETURN NEW;
      END IF;
    END IF;
    IF TG_TABLE_NAME = 'lead_activities'
       AND (to_jsonb(OLD) -> 'private_payload_ciphertext') = 'null'::jsonb AND (to_jsonb(NEW) -> 'private_payload_ciphertext') <> 'null'::jsonb
       AND (to_jsonb(OLD) - 'private_payload_ciphertext') = (to_jsonb(NEW) - 'private_payload_ciphertext') THEN
      RETURN NEW;
    ELSIF TG_TABLE_NAME = 'lead_conversions'
       AND (to_jsonb(OLD) -> 'identity_evidence_ciphertext') = 'null'::jsonb AND (to_jsonb(NEW) -> 'identity_evidence_ciphertext') <> 'null'::jsonb
       AND (to_jsonb(OLD) - 'identity_evidence_ciphertext') = (to_jsonb(NEW) - 'identity_evidence_ciphertext') THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'lead history is append-only';
END $$;

COMMENT ON FUNCTION prevent_lead_history_mutation() IS 'Lead history remains append-only; migration-only field-key rotation may replace only authenticated ciphertext when the transaction-local rudra.lead_sensitive_key_rotation flag is on. The application role has no UPDATE grant.';
