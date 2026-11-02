ALTER TABLE report_followup_events ADD COLUMN idempotency_key uuid;
CREATE UNIQUE INDEX report_followup_events_idempotency_uq ON report_followup_events(organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL;

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
 IF NEW.status='DELIVERED' AND NOT EXISTS(SELECT 1 FROM report_deliveries WHERE report_id=NEW.id AND organization_id=NEW.organization_id AND outcome='ACKNOWLEDGED' AND evidence_reference IS NOT NULL) THEN RAISE EXCEPTION 'delivery acknowledgment required'; END IF;
 RETURN NEW;
END;
$$;
