-- Stage authenticated private payloads before the separately verified plaintext cutover.
ALTER TABLE finance_payments ADD COLUMN private_data_ciphertext text;
ALTER TABLE finance_adjustments ADD COLUMN private_data_ciphertext text;
ALTER TABLE finance_adjustments ALTER COLUMN reason DROP NOT NULL;
ALTER TABLE finance_refunds ADD COLUMN private_data_ciphertext text;
ALTER TABLE finance_refunds ALTER COLUMN reason DROP NOT NULL;
ALTER TABLE finance_refunds DROP CONSTRAINT finance_refunds_check;
ALTER TABLE finance_refunds ADD CONSTRAINT finance_refunds_evidence_check CHECK ((status NOT IN ('APPROVED','EXECUTION_RECORDED') OR (approved_by_staff_id IS NOT NULL AND approved_at IS NOT NULL)) AND (status <> 'EXECUTION_RECORDED' OR ((execution_reference IS NOT NULL OR private_data_ciphertext IS NOT NULL) AND executed_by_staff_id IS NOT NULL AND executed_at IS NOT NULL)) AND (approved_by_staff_id IS NULL OR approved_by_staff_id <> requested_by_staff_id));
ALTER TABLE finance_events ADD COLUMN private_data_ciphertext text;
ALTER TABLE finance_reconciliations ADD COLUMN private_data_ciphertext text;

ALTER TABLE diagnostic_reports ADD COLUMN private_data_ciphertext text;
ALTER TABLE report_events ADD COLUMN private_data_ciphertext text;
ALTER TABLE report_deliveries ADD COLUMN private_data_ciphertext text;
ALTER TABLE report_deliveries ADD COLUMN evidence_provided boolean;
CREATE OR REPLACE FUNCTION prevent_report_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND TG_TABLE_NAME IN ('report_events','report_deliveries','report_followup_events')
     AND OLD.private_data_ciphertext IS NULL AND NEW.private_data_ciphertext IS NULL
     AND (to_jsonb(OLD) - 'evidence_provided') = (to_jsonb(NEW) - 'evidence_provided') THEN
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND TG_TABLE_NAME IN ('report_events','report_deliveries','report_followup_events')
     AND OLD.private_data_ciphertext IS NULL AND NEW.private_data_ciphertext IS NOT NULL
     AND (to_jsonb(OLD) - 'private_data_ciphertext') = (to_jsonb(NEW) - 'private_data_ciphertext') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'report history is append-only';
END $$;
UPDATE report_deliveries SET evidence_provided=(evidence_reference IS NOT NULL);
ALTER TABLE report_deliveries DROP CONSTRAINT report_deliveries_ack_evidence;
ALTER TABLE report_deliveries ADD CONSTRAINT report_deliveries_ack_evidence CHECK (outcome <> 'ACKNOWLEDGED' OR evidence_provided);

CREATE FUNCTION derive_report_delivery_evidence_presence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.evidence_provided IS NULL THEN NEW.evidence_provided := NEW.evidence_reference IS NOT NULL; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER report_delivery_evidence_presence BEFORE INSERT ON report_deliveries FOR EACH ROW EXECUTE FUNCTION derive_report_delivery_evidence_presence();
ALTER TABLE report_deliveries ALTER COLUMN recipient_label DROP NOT NULL;
ALTER TABLE report_deliveries ALTER COLUMN recipient_verification_reference DROP NOT NULL;
ALTER TABLE report_followups ADD COLUMN private_data_ciphertext text;
ALTER TABLE report_followups ALTER COLUMN outcome_note DROP NOT NULL;
ALTER TABLE report_followup_events ADD COLUMN private_data_ciphertext text;

-- Append-only event triggers allow exactly one ciphertext-only backfill update.
CREATE OR REPLACE FUNCTION finance_history_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='UPDATE' AND TG_TABLE_NAME IN ('finance_events','finance_adjustments','finance_reconciliations')
     AND OLD.private_data_ciphertext IS NULL AND NEW.private_data_ciphertext IS NOT NULL
     AND (to_jsonb(OLD) - 'private_data_ciphertext') = (to_jsonb(NEW) - 'private_data_ciphertext') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'financial history is append-only';
END $$;

CREATE OR REPLACE FUNCTION guard_diagnostic_report_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'report records cannot be deleted'; END IF;
 IF NEW.organization_id<>OLD.organization_id OR NEW.centre_id<>OLD.centre_id OR NEW.patient_id<>OLD.patient_id OR NEW.order_id<>OLD.order_id OR NEW.report_number<>OLD.report_number OR NEW.version_number<>OLD.version_number OR NEW.supersedes_report_id IS DISTINCT FROM OLD.supersedes_report_id OR NEW.uploader_staff_id<>OLD.uploader_staff_id THEN RAISE EXCEPTION 'report identity fields are immutable'; END IF;
 IF NEW.status<>OLD.status AND NOT (
   (OLD.status='AWAITING_REPORT' AND NEW.status IN ('QUARANTINED','PENDING_VERIFICATION','ON_HOLD')) OR
   (OLD.status='QUARANTINED' AND NEW.status IN ('PENDING_VERIFICATION','ON_HOLD')) OR
   (OLD.status='PENDING_VERIFICATION' AND NEW.status IN ('VERIFIED','ON_HOLD','QUARANTINED')) OR
   (OLD.status='VERIFIED' AND NEW.status IN ('APPROVED_FOR_RELEASE','ON_HOLD')) OR
   (OLD.status='APPROVED_FOR_RELEASE' AND NEW.status IN ('DELIVERY_PENDING','DELIVERED','SUPERSEDED','ON_HOLD')) OR
   (OLD.status='DELIVERY_PENDING' AND NEW.status IN ('DELIVERED','ON_HOLD')) OR
   (OLD.status='ON_HOLD' AND NEW.status IN ('PENDING_VERIFICATION','QUARANTINED','EXCEPTION')) OR
   (OLD.status='EXCEPTION' AND NEW.status IN ('PENDING_VERIFICATION','ON_HOLD')) OR
   (OLD.status='DELIVERED' AND NEW.status='SUPERSEDED')
 ) THEN RAISE EXCEPTION 'invalid report status transition'; END IF;
 IF NEW.status='VERIFIED' AND (NEW.verified_by_staff_id IS NULL OR NEW.verified_by_staff_id=NEW.uploader_staff_id OR (SELECT scan_status FROM report_documents WHERE report_id=NEW.id AND organization_id=NEW.organization_id ORDER BY uploaded_at DESC LIMIT 1) IS DISTINCT FROM 'CLEAN') THEN RAISE EXCEPTION 'independent verification and latest clean scan required'; END IF;
 IF NEW.status='APPROVED_FOR_RELEASE' AND (NEW.released_by_staff_id IS NULL OR NEW.released_by_staff_id=NEW.verified_by_staff_id) THEN RAISE EXCEPTION 'separate release approver required'; END IF;
 IF NEW.status='DELIVERED' AND NOT EXISTS(SELECT 1 FROM report_deliveries WHERE report_id=NEW.id AND organization_id=NEW.organization_id AND outcome='ACKNOWLEDGED' AND evidence_provided) THEN RAISE EXCEPTION 'delivery acknowledgment evidence required'; END IF;
 RETURN NEW;
END;
$$;

COMMENT ON COLUMN finance_payments.private_data_ciphertext IS 'Authenticated encrypted payment reference; arithmetic fields remain structured.';
COMMENT ON COLUMN diagnostic_reports.private_data_ciphertext IS 'Authenticated encrypted external references and private report metadata.';
