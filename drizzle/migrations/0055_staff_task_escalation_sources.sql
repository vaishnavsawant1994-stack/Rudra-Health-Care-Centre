ALTER TABLE staff_escalations
  DROP CONSTRAINT staff_escalations_source_type_check;

ALTER TABLE staff_escalations
  ADD CONSTRAINT staff_escalations_source_type_check
  CHECK (source_type IN (
    'APPOINTMENT', 'LEAD', 'COLLECTION_JOB', 'SAMPLE_EXCEPTION',
    'REPORT', 'REPORT_FOLLOWUP', 'FINANCE_PAYMENT', 'FINANCE_REFUND',
    'STAFF_TASK'
  ));

COMMENT ON CONSTRAINT staff_escalations_source_type_check ON staff_escalations IS
  'Source types are resolved by the application only after checking the matching source-domain permission and organization/centre scope.';
