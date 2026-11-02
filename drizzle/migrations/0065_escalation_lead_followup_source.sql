ALTER TABLE staff_escalations DROP CONSTRAINT staff_escalations_source_type_check;
ALTER TABLE staff_escalations ADD CONSTRAINT staff_escalations_source_type_check
  CHECK (source_type IN ('APPOINTMENT','LEAD','LEAD_FOLLOWUP','COLLECTION_JOB','SAMPLE_EXCEPTION','REPORT','REPORT_FOLLOWUP','FINANCE_PAYMENT','FINANCE_REFUND','STAFF_TASK'));
