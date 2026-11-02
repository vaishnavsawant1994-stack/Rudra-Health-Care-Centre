DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM patients p
    LEFT JOIN patient_contact_secrets s ON s.patient_id=p.id AND s.organization_id=p.organization_id AND s.centre_id=p.centre_id
    WHERE s.patient_id IS NULL OR s.name_ciphertext IS NULL
      OR s.first_name_blind_index IS NULL OR s.last_name_blind_index IS NULL OR s.full_name_blind_index IS NULL
  ) THEN
    RAISE EXCEPTION 'patient name encryption backfill incomplete; run the verified name backfill before cutover';
  END IF;
END $$;

ALTER TABLE patient_contact_secrets
  ALTER COLUMN name_ciphertext SET NOT NULL,
  ALTER COLUMN first_name_blind_index SET NOT NULL,
  ALTER COLUMN last_name_blind_index SET NOT NULL,
  ALTER COLUMN full_name_blind_index SET NOT NULL;

DROP INDEX patients_name_search_idx;
ALTER TABLE patients DROP COLUMN first_name, DROP COLUMN last_name;
COMMENT ON TABLE patients IS 'Patient directory and consent metadata. Identity and contact data are stored in patient_contact_secrets with authenticated encryption and purpose-specific keyed indexes.';
