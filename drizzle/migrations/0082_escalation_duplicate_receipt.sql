ALTER TABLE staff_escalation_events
  DROP CONSTRAINT staff_escalation_events_event_type_check;

ALTER TABLE staff_escalation_events
  ADD CONSTRAINT staff_escalation_events_event_type_check
  CHECK (event_type IN ('CREATED','ACKNOWLEDGED','UPDATED','REASSIGNED','COMMENTED','RESOLVED','REOPENED','CANCELLED','DUPLICATE_CREATE_SUPPRESSED'));

COMMENT ON COLUMN staff_escalation_events.idempotency_key IS
  'Organization-scoped idempotency key for an escalation mutation or suppressed duplicate create request.';
