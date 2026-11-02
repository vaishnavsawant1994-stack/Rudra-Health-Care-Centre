DO $$
DECLARE missing_tables text[] := ARRAY[]::text[];
BEGIN
  IF EXISTS (SELECT 1 FROM finance_payments WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM finance_adjustments WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM finance_refunds WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM finance_events WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM finance_reconciliations WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM diagnostic_reports WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM report_events WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM report_deliveries WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM report_followups WHERE private_data_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM report_followup_events WHERE private_data_ciphertext IS NULL) THEN
    RAISE EXCEPTION 'Finance/report encrypted-data preflight failed; plaintext cutover is blocked';
  END IF;
END $$;

ALTER TABLE finance_payments ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE finance_adjustments ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE finance_refunds ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE finance_events ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE finance_reconciliations ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE diagnostic_reports ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE report_events ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE report_deliveries ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE report_followups ALTER COLUMN private_data_ciphertext SET NOT NULL;
ALTER TABLE report_followup_events ALTER COLUMN private_data_ciphertext SET NOT NULL;

-- The task state remains structural; outcome text is available only in the encrypted payload.
ALTER TABLE report_followups DROP CONSTRAINT report_followups_completion;
ALTER TABLE report_followups ADD CONSTRAINT report_followups_completion CHECK ((status IN ('COMPLETED','UNSUCCESSFUL') AND completed_by_staff_id IS NOT NULL AND completed_at IS NOT NULL) OR (status NOT IN ('COMPLETED','UNSUCCESSFUL') AND completed_by_staff_id IS NULL AND completed_at IS NULL));

DROP TRIGGER report_delivery_evidence_presence ON report_deliveries;
DROP FUNCTION derive_report_delivery_evidence_presence();

ALTER TABLE finance_payments DROP COLUMN reference;
ALTER TABLE finance_adjustments DROP COLUMN reason;
ALTER TABLE finance_refunds DROP CONSTRAINT finance_refunds_evidence_check;
ALTER TABLE finance_refunds DROP COLUMN reason;
ALTER TABLE finance_refunds DROP COLUMN execution_reference;
ALTER TABLE finance_refunds ADD CONSTRAINT finance_refunds_evidence_check CHECK ((status NOT IN ('APPROVED','EXECUTION_RECORDED') OR (approved_by_staff_id IS NOT NULL AND approved_at IS NOT NULL)) AND (status <> 'EXECUTION_RECORDED' OR (private_data_ciphertext IS NOT NULL AND executed_by_staff_id IS NOT NULL AND executed_at IS NOT NULL)) AND (approved_by_staff_id IS NULL OR approved_by_staff_id <> requested_by_staff_id));
ALTER TABLE finance_events DROP COLUMN reason;
ALTER TABLE finance_events DROP COLUMN evidence_reference;
ALTER TABLE finance_reconciliations DROP COLUMN reason;

ALTER TABLE diagnostic_reports DROP COLUMN external_reference;
ALTER TABLE diagnostic_reports DROP COLUMN hold_reason;
ALTER TABLE report_events DROP COLUMN reason;
ALTER TABLE report_events DROP COLUMN evidence_reference;
ALTER TABLE report_deliveries DROP COLUMN recipient_label;
ALTER TABLE report_deliveries DROP COLUMN recipient_verification_reference;
ALTER TABLE report_deliveries DROP COLUMN evidence_reference;
ALTER TABLE report_followups DROP COLUMN outcome_note;
ALTER TABLE report_followups DROP COLUMN outcome;
ALTER TABLE report_followup_events DROP COLUMN note;

COMMENT ON COLUMN finance_payments.private_data_ciphertext IS 'Authenticated encrypted payment reference; no plaintext reference is retained.';
COMMENT ON COLUMN report_deliveries.private_data_ciphertext IS 'Authenticated encrypted recipient and delivery evidence; accessible only after server authorization.';
