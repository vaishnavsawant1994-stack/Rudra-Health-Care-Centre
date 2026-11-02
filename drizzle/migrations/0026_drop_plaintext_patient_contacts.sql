DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM patients p
    LEFT JOIN patient_contact_secrets s ON s.patient_id=p.id AND s.organization_id=p.organization_id AND s.centre_id=p.centre_id
    WHERE s.patient_id IS NULL OR (p.email IS NOT NULL AND s.email_ciphertext IS NULL)
  ) THEN
    RAISE EXCEPTION 'patient contact encryption backfill incomplete; run db:encrypt-patient-contacts and retry migration';
  END IF;
END $$;

ALTER TABLE patients DROP CONSTRAINT patients_nonblank_phone;
ALTER TABLE patients DROP COLUMN phone, DROP COLUMN email;
COMMENT ON TABLE patients IS 'Patient directory and consent metadata. Contact details are stored in patient_contact_secrets with authenticated encryption and keyed indexes.';
