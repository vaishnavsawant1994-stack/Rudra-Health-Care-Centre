ALTER TABLE staff_approval_policies
  ADD COLUMN expire_after_minutes integer
  CHECK (expire_after_minutes IS NULL OR expire_after_minutes BETWEEN 15 AND 10080);

ALTER TABLE staff_tasks
  ADD COLUMN approval_expires_at timestamptz;
CREATE INDEX staff_tasks_approval_expiry_idx
  ON staff_tasks (organization_id, centre_id, approval_expires_at)
  WHERE status = 'AWAITING_APPROVAL' AND approval_status = 'PENDING' AND approval_expires_at IS NOT NULL;

ALTER TABLE staff_tasks DROP CONSTRAINT staff_tasks_approval_status_check;
ALTER TABLE staff_tasks ADD CONSTRAINT staff_tasks_approval_status_check
  CHECK (approval_status IN ('NOT_REQUIRED','PENDING','APPROVED','REJECTED','CHANGES_REQUESTED','EXPIRED'));

ALTER TABLE staff_task_events DROP CONSTRAINT staff_task_events_event_type_check;
ALTER TABLE staff_task_events ADD CONSTRAINT staff_task_events_event_type_check
  CHECK (event_type IN ('CREATED','UPDATED','ASSIGNED','REASSIGNED','COMMENTED','STARTED','COMPLETED','SUBMITTED_FOR_APPROVAL','APPROVED','REJECTED','CHANGES_REQUESTED','CANCELLED','REOPENED','ESCALATION_REASSIGNED','ESCALATED','APPROVAL_EXPIRED'));
