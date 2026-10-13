-- Addresses contain direct patient location data. Move the structured payload
-- to an authenticated encrypted field before the operational APIs use it.
-- This R1.1 migration is intended for the empty pre-production database.
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM patient_addresses) THEN
    RAISE EXCEPTION 'patient_addresses contains rows; export and encrypt them with the approved key-management process before applying migration 007';
  END IF;
END;
$$;
ALTER TABLE patient_addresses
  DROP COLUMN label,
  DROP COLUMN address_line_1,
  DROP COLUMN address_line_2,
  DROP COLUMN landmark,
  DROP COLUMN city,
  DROP COLUMN state,
  DROP COLUMN postal_code,
  DROP COLUMN country,
  DROP COLUMN latitude,
  DROP COLUMN longitude,
  ADD COLUMN address_ciphertext bytea NOT NULL;
COMMIT;
