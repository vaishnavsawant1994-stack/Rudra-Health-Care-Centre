ALTER TABLE doctor_relationship_events
  DROP CONSTRAINT doctor_relationship_events_event_type_check;

ALTER TABLE doctor_relationship_events
  ADD CONSTRAINT doctor_relationship_events_event_type_check
  CHECK (event_type IN (
    'CREATED', 'UPDATED', 'STATUS_CHANGED', 'REFERRAL_RECORDED',
    'VISIT_PLANNED', 'VISIT_CHECKED_IN', 'VISIT_RECORDED', 'VISIT_CANCELLED'
  ));

COMMENT ON CONSTRAINT doctor_relationship_events_event_type_check ON doctor_relationship_events IS
  'Append-only encrypted doctor relationship and field-visit events.';
