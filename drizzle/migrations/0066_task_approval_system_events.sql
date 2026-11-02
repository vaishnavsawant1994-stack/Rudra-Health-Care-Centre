ALTER TABLE staff_task_events
  ADD COLUMN actor_type varchar(12) NOT NULL DEFAULT 'STAFF';

ALTER TABLE staff_task_events
  ALTER COLUMN actor_staff_id DROP NOT NULL;

ALTER TABLE staff_task_events
  ADD CONSTRAINT staff_task_events_actor_type_check
  CHECK ((actor_type = 'STAFF' AND actor_staff_id IS NOT NULL)
      OR (actor_type = 'SYSTEM' AND actor_staff_id IS NULL));
