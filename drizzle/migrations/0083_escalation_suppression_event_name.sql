ALTER TABLE staff_escalation_events
  DROP CONSTRAINT staff_escalation_events_event_type_check;

ALTER TABLE staff_escalation_events
  ADD CONSTRAINT staff_escalation_events_event_type_check
  CHECK (event_type IN ('CREATED','ACKNOWLEDGED','UPDATED','REASSIGNED','COMMENTED','RESOLVED','REOPENED','CANCELLED','DUPLICATE_SUPPRESSED'));
