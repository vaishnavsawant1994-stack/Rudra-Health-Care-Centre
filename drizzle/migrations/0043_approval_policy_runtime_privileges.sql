-- Approval policy configuration is updated through the authorized policy API;
-- the runtime role must not be able to delete policy history/configuration.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN
    REVOKE DELETE ON staff_approval_policies FROM rudra_dev_app;
    REVOKE UPDATE ON staff_approval_policy_approvers FROM rudra_dev_app;
  END IF;
END $$;
