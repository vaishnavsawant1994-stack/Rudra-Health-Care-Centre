ALTER TABLE staff_task_events
  ADD COLUMN idempotency_key uuid,
  ADD COLUMN request_hash varchar(64);

ALTER TABLE staff_task_events
  ADD CONSTRAINT staff_task_events_idempotency_pair_check
  CHECK ((idempotency_key IS NULL AND request_hash IS NULL)
      OR (idempotency_key IS NOT NULL AND request_hash ~ '^[a-f0-9]{64}$'));

CREATE UNIQUE INDEX staff_task_events_idempotency_uq
  ON staff_task_events (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON INDEX staff_task_events_idempotency_uq IS
  'Serializes and resolves retries of staff task actions using the append-only event result.';
