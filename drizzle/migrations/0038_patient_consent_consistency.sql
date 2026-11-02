ALTER TABLE patients
  ALTER COLUMN consent_recorded_at DROP NOT NULL,
  ALTER COLUMN consent_method DROP NOT NULL;

ALTER TABLE patients
  ADD CONSTRAINT patients_consent_recorded_consistency CHECK (
    (consent_status = 'NOT_RECORDED' AND consent_method IS NULL AND consent_recorded_at IS NULL)
    OR
    (consent_status <> 'NOT_RECORDED' AND consent_method IS NOT NULL AND consent_recorded_at IS NOT NULL)
  );

COMMENT ON COLUMN patients.consent_status IS 'NOT_RECORDED means no consent outcome/evidence has been documented; it is not permission or a refusal.';