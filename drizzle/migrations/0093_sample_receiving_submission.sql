-- Distinguish a field-staff submission to the Rudra receiving queue from
-- receiving staff's later, evidence-backed custody acknowledgment.
-- Existing specimens retain the legacy receiving path; new specimens opt in
-- explicitly in the application write path, so no old custody claim is inferred.
ALTER TABLE specimens
  ADD COLUMN receiving_submission_required boolean NOT NULL DEFAULT false;

ALTER TABLE sample_custody_events
  ADD COLUMN idempotency_key uuid;

CREATE UNIQUE INDEX sample_custody_events_idempotency_uq
  ON sample_custody_events(organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

ALTER TABLE sample_custody_events
  DROP CONSTRAINT sample_custody_events_event_type_check;

ALTER TABLE sample_custody_events
  ADD CONSTRAINT sample_custody_events_event_type_check
  CHECK (event_type IN (
    'COLLECTED', 'SUBMITTED_FOR_RECEIVING', 'RECEIVED_AT_RUDRA', 'PACKED',
    'DISPATCHED', 'EXTERNAL_RECEIPT_RECORDED', 'EXCEPTION_RECORDED',
    'RECOLLECTION_REQUESTED', 'CORRECTION_RECORDED'
  ));

COMMENT ON COLUMN specimens.receiving_submission_required IS
  'New collection records require an append-only SUBMITTED_FOR_RECEIVING event before receiver acknowledgment; legacy rows remain compatible.';

COMMENT ON COLUMN sample_custody_events.idempotency_key IS
  'Optional idempotency key for staff custody actions that support safe replay.';
