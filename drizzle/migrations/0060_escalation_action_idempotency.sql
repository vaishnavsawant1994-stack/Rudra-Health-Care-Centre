ALTER TABLE staff_escalation_events
  ADD COLUMN idempotency_key uuid,
  ADD COLUMN request_hash varchar(64);

CREATE UNIQUE INDEX staff_escalation_events_idempotency_uq
  ON staff_escalation_events (organization_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN staff_escalation_events.idempotency_key IS
  'Organization-scoped idempotency key for an escalation state mutation; null for pre-migration events.';
