CREATE TABLE diagnostic_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  order_id uuid NOT NULL,
  report_number varchar(32) NOT NULL,
  external_reference varchar(160),
  source varchar(24) NOT NULL DEFAULT 'MANUAL' CHECK (source IN ('MANUAL','METROPOLIS_REFERENCE')),
  external_issued_at timestamptz,
  status varchar(32) NOT NULL DEFAULT 'AWAITING_REPORT' CHECK (status IN ('AWAITING_REPORT','QUARANTINED','PENDING_VERIFICATION','VERIFIED','APPROVED_FOR_RELEASE','DELIVERY_PENDING','DELIVERED','SUPERSEDED','ON_HOLD','EXCEPTION')),
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  supersedes_report_id uuid,
  uploader_staff_id uuid NOT NULL,
  verified_by_staff_id uuid,
  released_by_staff_id uuid,
  hold_reason varchar(240),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT diagnostic_reports_org_number_uq UNIQUE (organization_id, report_number),
  CONSTRAINT diagnostic_reports_id_scope_uq UNIQUE (id, organization_id, centre_id),
  CONSTRAINT diagnostic_reports_patient_scope_fk FOREIGN KEY (patient_id, organization_id, centre_id) REFERENCES patients(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT diagnostic_reports_order_scope_fk FOREIGN KEY (order_id, organization_id, centre_id) REFERENCES diagnostic_orders(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT diagnostic_reports_centre_scope_fk FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT diagnostic_reports_uploader_scope_fk FOREIGN KEY (uploader_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT diagnostic_reports_verifier_scope_fk FOREIGN KEY (verified_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT diagnostic_reports_releaser_scope_fk FOREIGN KEY (released_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT diagnostic_reports_supersedes_scope_fk FOREIGN KEY (supersedes_report_id, organization_id, centre_id) REFERENCES diagnostic_reports(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT diagnostic_reports_supersedes_not_self CHECK (supersedes_report_id IS NULL OR supersedes_report_id <> id),
  CONSTRAINT diagnostic_reports_release_gates CHECK (status NOT IN ('VERIFIED','APPROVED_FOR_RELEASE','DELIVERY_PENDING','DELIVERED','SUPERSEDED') OR verified_by_staff_id IS NOT NULL),
  CONSTRAINT diagnostic_reports_release_actor CHECK (status NOT IN ('APPROVED_FOR_RELEASE','DELIVERY_PENDING','DELIVERED','SUPERSEDED') OR released_by_staff_id IS NOT NULL)
);
CREATE INDEX diagnostic_reports_centre_status_idx ON diagnostic_reports(organization_id, centre_id, status, created_at DESC);
CREATE INDEX diagnostic_reports_patient_idx ON diagnostic_reports(organization_id, patient_id, created_at DESC);
CREATE INDEX diagnostic_reports_order_idx ON diagnostic_reports(organization_id, order_id, created_at DESC);

CREATE TABLE report_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  report_id uuid NOT NULL,
  storage_key varchar(80) NOT NULL UNIQUE,
  original_filename varchar(120) NOT NULL,
  media_type varchar(40) NOT NULL CHECK (media_type = 'application/pdf'),
  byte_size integer NOT NULL CHECK (byte_size BETWEEN 1 AND 10485760),
  sha256 char(64) NOT NULL,
  scan_status varchar(20) NOT NULL CHECK (scan_status IN ('CLEAN','QUARANTINED','REJECTED')),
  scan_engine varchar(80),
  idempotency_key uuid NOT NULL,
  uploaded_by_staff_id uuid NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_documents_report_scope_fk FOREIGN KEY (report_id, organization_id, centre_id) REFERENCES diagnostic_reports(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT report_documents_uploader_scope_fk FOREIGN KEY (uploaded_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX report_documents_report_idx ON report_documents(organization_id, report_id, uploaded_at DESC);
CREATE UNIQUE INDEX report_documents_idempotency_uq ON report_documents(organization_id,idempotency_key);

CREATE TABLE report_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  report_id uuid NOT NULL,
  event_type varchar(32) NOT NULL CHECK (event_type IN ('REGISTERED','DOCUMENT_UPLOADED','VERIFIED','RELEASE_APPROVED','DELIVERY_ATTEMPTED','DELIVERED','CORRECTED','SUPERSEDED','HOLD_PLACED','HOLD_CLEARED','EXCEPTION_RECORDED')),
  source varchar(24) NOT NULL DEFAULT 'STAFF_RECORDED',
  idempotency_key uuid,
  reason varchar(240),
  evidence_reference varchar(200),
  actor_staff_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_events_report_scope_fk FOREIGN KEY (report_id, organization_id, centre_id) REFERENCES diagnostic_reports(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT report_events_actor_scope_fk FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX report_events_idempotency_uq ON report_events(organization_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX report_events_timeline_idx ON report_events(organization_id, report_id, recorded_at);

CREATE TABLE report_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  report_id uuid NOT NULL,
  recipient_label varchar(120) NOT NULL,
  recipient_verification_reference varchar(200) NOT NULL,
  channel varchar(24) NOT NULL CHECK (channel IN ('PHYSICAL_COLLECTION','AUTHORIZED_STAFF_HANDOFF')),
  outcome varchar(20) NOT NULL CHECK (outcome IN ('ATTEMPTED','FAILED','ACKNOWLEDGED')),
  evidence_reference varchar(200),
  idempotency_key uuid NOT NULL,
  actor_staff_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_deliveries_ack_evidence CHECK (outcome <> 'ACKNOWLEDGED' OR evidence_reference IS NOT NULL),
  CONSTRAINT report_deliveries_report_scope_fk FOREIGN KEY (report_id, organization_id, centre_id) REFERENCES diagnostic_reports(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT report_deliveries_actor_scope_fk FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX report_deliveries_idempotency_uq ON report_deliveries(organization_id,idempotency_key);

CREATE TABLE report_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  report_id uuid NOT NULL,
  assigned_staff_id uuid NOT NULL,
  task_type varchar(32) NOT NULL CHECK (task_type IN ('REPORT_READY','REPORT_PENDING','DELIVERY_CONFIRMATION','RECOLLECTION_COORDINATION','APPOINTMENT','ENQUIRY')),
  idempotency_key uuid NOT NULL,
  due_at timestamptz NOT NULL,
  priority varchar(12) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status varchar(20) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','COMPLETED','UNSUCCESSFUL','CANCELLED')),
  outcome varchar(24),
  outcome_note varchar(240),
  created_by_staff_id uuid NOT NULL,
  completed_by_staff_id uuid,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_followups_report_scope_fk FOREIGN KEY (report_id, organization_id, centre_id) REFERENCES diagnostic_reports(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT report_followups_assignee_scope_fk FOREIGN KEY (assigned_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT report_followups_creator_scope_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT report_followups_completer_scope_fk FOREIGN KEY (completed_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT report_followups_completion CHECK ((status IN ('COMPLETED','UNSUCCESSFUL') AND completed_by_staff_id IS NOT NULL AND completed_at IS NOT NULL AND outcome IS NOT NULL) OR (status NOT IN ('COMPLETED','UNSUCCESSFUL') AND outcome IS NULL))
);
CREATE UNIQUE INDEX report_followups_idempotency_uq ON report_followups(organization_id,idempotency_key);
CREATE INDEX report_followups_due_idx ON report_followups(organization_id, centre_id, status, due_at);

CREATE TABLE report_followup_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  followup_id uuid NOT NULL REFERENCES report_followups(id) ON DELETE RESTRICT,
  event_type varchar(24) NOT NULL CHECK (event_type IN ('CREATED','REASSIGNED','RESCHEDULED','COMPLETED','UNSUCCESSFUL','CANCELLED','NOTE')),
  note varchar(240),
  actor_staff_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT report_followup_events_actor_scope_fk FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);

CREATE FUNCTION prevent_report_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'report history is append-only'; END;
$$;
CREATE FUNCTION guard_diagnostic_report_update() RETURNS trigger LANGUAGE plpgsql AS $$
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
 IF NEW.status='VERIFIED' AND (NEW.verified_by_staff_id IS NULL OR NEW.verified_by_staff_id=NEW.uploader_staff_id OR NOT EXISTS(SELECT 1 FROM report_documents WHERE report_id=NEW.id AND organization_id=NEW.organization_id AND scan_status='CLEAN')) THEN RAISE EXCEPTION 'independent verification and clean scan required'; END IF;
 IF NEW.status='APPROVED_FOR_RELEASE' AND (NEW.released_by_staff_id IS NULL OR NEW.released_by_staff_id=NEW.verified_by_staff_id) THEN RAISE EXCEPTION 'separate release approver required'; END IF;
 IF NEW.status='DELIVERED' AND NOT EXISTS(SELECT 1 FROM report_deliveries WHERE report_id=NEW.id AND organization_id=NEW.organization_id AND outcome='ACKNOWLEDGED') THEN RAISE EXCEPTION 'delivery acknowledgment required'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER diagnostic_reports_guard BEFORE UPDATE OR DELETE ON diagnostic_reports FOR EACH ROW EXECUTE FUNCTION guard_diagnostic_report_update();
CREATE TRIGGER report_events_append_only BEFORE UPDATE OR DELETE ON report_events FOR EACH ROW EXECUTE FUNCTION prevent_report_history_mutation();
CREATE TRIGGER report_deliveries_append_only BEFORE UPDATE OR DELETE ON report_deliveries FOR EACH ROW EXECUTE FUNCTION prevent_report_history_mutation();
CREATE TRIGGER report_followup_events_append_only BEFORE UPDATE OR DELETE ON report_followup_events FOR EACH ROW EXECUTE FUNCTION prevent_report_history_mutation();
CREATE TRIGGER report_documents_immutable BEFORE UPDATE OR DELETE ON report_documents FOR EACH ROW EXECUTE FUNCTION prevent_report_history_mutation();
CREATE TRIGGER report_followups_no_delete BEFORE DELETE ON report_followups FOR EACH ROW EXECUTE FUNCTION prevent_report_history_mutation();

INSERT INTO permissions (key, description, scope) VALUES
 ('reports.read','View diagnostic report operations in authorized centres','CENTRE'),
 ('reports.register','Register incoming report references','CENTRE'),
 ('reports.document.upload','Upload private diagnostic report documents','CENTRE'),
 ('reports.verify','Verify report provenance and patient/order identity','CENTRE'),
 ('reports.release','Approve reports for controlled release','CENTRE'),
 ('reports.deliver','Record authorized report handoff and evidence','CENTRE'),
 ('reports.followups.manage','Manage internal report follow-up tasks','CENTRE'),
 ('reports.exceptions.manage','Place reports on hold and record discrepancies','CENTRE')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = ANY(CASE r.key
 WHEN 'owner_super_admin' THEN ARRAY['reports.read','reports.register','reports.document.upload','reports.verify','reports.release','reports.deliver','reports.followups.manage','reports.exceptions.manage']
 WHEN 'administrator' THEN ARRAY['reports.read','reports.register','reports.document.upload','reports.verify','reports.release','reports.deliver','reports.followups.manage','reports.exceptions.manage']
 WHEN 'centre_manager' THEN ARRAY['reports.read','reports.register','reports.document.upload','reports.verify','reports.release','reports.deliver','reports.followups.manage','reports.exceptions.manage']
 WHEN 'laboratory_branch_operations' THEN ARRAY['reports.read','reports.register','reports.document.upload','reports.verify','reports.exceptions.manage']
 WHEN 'receptionist' THEN ARRAY['reports.read','reports.followups.manage']
 WHEN 'customer_support' THEN ARRAY['reports.read','reports.followups.manage']
 WHEN 'read_only_auditor' THEN ARRAY['reports.read']
 ELSE ARRAY[]::text[] END)
ON CONFLICT (role_id, permission_id) DO NOTHING;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app') THEN
  GRANT SELECT, INSERT, UPDATE ON diagnostic_reports, report_followups TO rudra_dev_app;
  GRANT SELECT, INSERT ON report_documents, report_events, report_deliveries, report_followup_events TO rudra_dev_app;
  REVOKE UPDATE, DELETE ON report_documents, report_events, report_deliveries, report_followup_events FROM rudra_dev_app;
  REVOKE DELETE ON diagnostic_reports, report_followups FROM rudra_dev_app;
 END IF;
END $$;

COMMENT ON TABLE diagnostic_reports IS 'Manual-first report intake. Clinical interpretation is outside this workflow; use synthetic data until private storage and encryption are qualified.';
COMMENT ON TABLE report_documents IS 'Private local development file metadata. Quarantined files are never served; configure a trusted malware scanner before verification or release.';
COMMENT ON TABLE report_followups IS 'Internal operational follow-up tasks only. This table does not send messages or authorize report access.';
