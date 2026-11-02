DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN
    REVOKE DELETE ON appointment_queue_tokens FROM rudra_dev_app;
    REVOKE UPDATE, DELETE ON appointment_queue_events FROM rudra_dev_app;
  END IF;
END $$;
