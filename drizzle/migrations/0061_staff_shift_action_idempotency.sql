ALTER TABLE staff_shift_events
  ADD COLUMN idempotency_key uuid,
  ADD COLUMN request_hash varchar(64);

CREATE UNIQUE INDEX staff_shift_events_idempotency_uq
  ON staff_shift_events (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN staff_shift_events.idempotency_key IS
  'Organization-scoped idempotency key for a shift update/cancellation action; null for historical events.';
