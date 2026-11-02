DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM appointments WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM appointment_services WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM appointment_status_history WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM appointment_assignment_history WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM collection_job_events WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM specimens WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM dispatch_batches WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM sample_custody_events WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM sample_external_receipts WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM sample_exceptions WHERE private_data_ciphertext IS NULL) THEN
    RAISE EXCEPTION 'operational encrypted-data backfill incomplete; verify the populated migration before cutover';
  END IF;
END $$;

ALTER TABLE appointments ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE appointment_services ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE appointment_status_history ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE appointment_assignment_history ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE collection_job_events ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE specimens ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE dispatch_batches ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE sample_custody_events ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE sample_external_receipts ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE sample_exceptions ALTER COLUMN private_data_ciphertext SET NOT NULL;

ALTER TABLE appointments DROP COLUMN home_collection_address, DROP COLUMN collection_instructions,
  DROP COLUMN communication_evidence_reference, DROP COLUMN home_charge_reason;
ALTER TABLE appointment_services DROP COLUMN service_name, DROP COLUMN service_reference;
ALTER TABLE appointment_status_history DROP COLUMN reason;
ALTER TABLE appointment_assignment_history DROP COLUMN reason;
ALTER TABLE collection_job_events DROP COLUMN reason, DROP COLUMN evidence_reference;
ALTER TABLE specimens DROP COLUMN specimen_type, DROP COLUMN requirement_reference;
ALTER TABLE dispatch_batches DROP COLUMN carrier_reference, DROP COLUMN external_lab_reference;
ALTER TABLE sample_custody_events DROP COLUMN evidence_reference, DROP COLUMN reason;
ALTER TABLE sample_external_receipts DROP COLUMN receipt_reference, DROP COLUMN evidence_reference;
ALTER TABLE sample_exceptions DROP COLUMN reason, DROP COLUMN resolution_reference;

COMMENT ON TABLE appointments IS 'Appointment timing, state and relational fields remain queryable; private address/instructions/evidence are authenticated ciphertext.';
COMMENT ON TABLE sample_custody_events IS 'Append-only custody event identity, provenance and timestamp remain visible; evidence and free-text reason are authenticated ciphertext.';
