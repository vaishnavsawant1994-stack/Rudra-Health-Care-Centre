DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM patients p
    LEFT JOIN patient_contact_secrets s ON s.patient_id=p.id AND s.organization_id=p.organization_id AND s.centre_id=p.centre_id
    WHERE s.patient_id IS NULL OR s.profile_ciphertext IS NULL
  ) THEN
    RAISE EXCEPTION 'patient profile encryption backfill incomplete; run db:encrypt-patient-profile and retry migration';
  END IF;
END $$;

ALTER TABLE patients DROP COLUMN preferred_name, DROP COLUMN date_of_birth, DROP COLUMN sex_at_registration, DROP COLUMN address;
