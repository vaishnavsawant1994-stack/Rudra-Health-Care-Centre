DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app') THEN
  REVOKE UPDATE, DELETE ON finance_charges FROM rudra_dev_app;
  REVOKE UPDATE, DELETE ON finance_allocations, finance_adjustments, finance_events FROM rudra_dev_app;
  REVOKE DELETE ON finance_refunds, finance_reconciliations FROM rudra_dev_app;
 END IF;
END $$;
