ALTER TABLE staff_tasks DROP CONSTRAINT staff_tasks_task_type_check;
ALTER TABLE staff_tasks
  ADD CONSTRAINT staff_tasks_task_type_check
  CHECK (task_type IN ('GENERAL', 'OPERATIONS', 'FOLLOW_UP', 'EXCEPTION_REVIEW', 'SUPPORT_REQUEST'));
