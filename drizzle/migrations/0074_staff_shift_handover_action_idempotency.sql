ALTER TABLE staff_shift_handover_events
  ADD COLUMN idempotency_key uuid,
  ADD COLUMN request_hash varchar(64);

ALTER TABLE staff_shift_handover_events
  ADD CONSTRAINT staff_shift_handover_events_request_hash_check
  CHECK ((idempotency_key IS NULL AND request_hash IS NULL) OR (idempotency_key IS NOT NULL AND request_hash ~ '^[0-9a-f]{64}$'));

CREATE UNIQUE INDEX staff_shift_handover_events_idempotency_uq
  ON staff_shift_handover_events (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN staff_shift_handover_events.idempotency_key IS
  'Organization-scoped idempotency key for a handover acknowledgement or cancellation; null for historical prepare events.';
