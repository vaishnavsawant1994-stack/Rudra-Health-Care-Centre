ALTER TABLE collection_job_events
  DROP CONSTRAINT collection_job_events_event_type_check;

ALTER TABLE collection_job_events
  ADD CONSTRAINT collection_job_events_event_type_check
  CHECK (event_type IN ('CREATED','ASSIGNED','REASSIGNED','VISIT_STARTED','ARRIVED','ATTEMPT_FAILED','COLLECTION_RECORDED','CANCELLED','RESCHEDULED','VISIT_DELAYED','ASSIGNMENT_DECLINED','ASSIGNMENT_ACCEPTED'));
