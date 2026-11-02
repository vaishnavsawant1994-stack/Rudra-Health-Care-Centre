CREATE TABLE collection_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, centre_id uuid NOT NULL,
  job_number varchar(32) NOT NULL, appointment_id uuid NOT NULL, order_id uuid NOT NULL, patient_id uuid NOT NULL,
  status varchar(24) NOT NULL CHECK (status IN ('PENDING_ASSIGNMENT','ASSIGNED','IN_PROGRESS','COLLECTED','UNSUCCESSFUL','CANCELLED')),
  assigned_staff_id uuid, scheduled_start timestamptz NOT NULL, scheduled_end timestamptz NOT NULL,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0), idempotency_key uuid NOT NULL,
  created_by_staff_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, job_number), UNIQUE (organization_id, order_id), UNIQUE (organization_id, idempotency_key),
  UNIQUE (id, organization_id, centre_id),
  FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (appointment_id, organization_id, centre_id) REFERENCES appointments(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id, organization_id, centre_id) REFERENCES diagnostic_orders(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (patient_id, organization_id, centre_id) REFERENCES patients(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (assigned_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CHECK (scheduled_end > scheduled_start),
  CHECK ((status = 'PENDING_ASSIGNMENT' AND assigned_staff_id IS NULL) OR (status <> 'PENDING_ASSIGNMENT' AND assigned_staff_id IS NOT NULL))
);
CREATE INDEX collection_jobs_schedule_idx ON collection_jobs(organization_id, centre_id, scheduled_start, status);
CREATE INDEX collection_jobs_staff_idx ON collection_jobs(organization_id, assigned_staff_id, scheduled_start, status);

CREATE TABLE collection_job_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, centre_id uuid NOT NULL, job_id uuid NOT NULL,
  event_type varchar(32) NOT NULL CHECK (event_type IN ('CREATED','ASSIGNED','REASSIGNED','VISIT_STARTED','ARRIVED','ATTEMPT_FAILED','COLLECTION_RECORDED','CANCELLED','RESCHEDULED')),
  source varchar(24) NOT NULL CHECK (source IN ('STAFF','SYSTEM')), reason varchar(240) NOT NULL,
  evidence_reference varchar(200), staff_id uuid, previous_staff_id uuid, actor_staff_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (job_id, organization_id, centre_id) REFERENCES collection_jobs(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (previous_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX collection_job_events_idx ON collection_job_events(organization_id, job_id, recorded_at);

CREATE TABLE sample_procedure_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, centre_id uuid NOT NULL,
  operation varchar(20) NOT NULL CHECK (operation IN ('COLLECTION','RECEIVING','PACKING','TRANSPORT')),
  reference varchar(200) NOT NULL, status varchar(16) NOT NULL CHECK (status IN ('ACTIVE','REVOKED')),
  approved_by_staff_id uuid NOT NULL, approved_at timestamptz NOT NULL DEFAULT now(), revoked_by_staff_id uuid, revoked_at timestamptz,
  FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (revoked_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CHECK ((status = 'ACTIVE' AND revoked_at IS NULL) OR (status = 'REVOKED' AND revoked_at IS NOT NULL)),
  UNIQUE (id, organization_id, centre_id)
);
CREATE UNIQUE INDEX sample_procedure_active_uq ON sample_procedure_approvals(organization_id, centre_id, operation, reference) WHERE status = 'ACTIVE';

CREATE TABLE specimens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, centre_id uuid NOT NULL, job_id uuid NOT NULL,
  order_id uuid NOT NULL, patient_id uuid NOT NULL, specimen_number varchar(32) NOT NULL,
  idempotency_key uuid NOT NULL,
  specimen_type varchar(100) NOT NULL, requirement_reference varchar(200) NOT NULL,
  status varchar(28) NOT NULL CHECK (status IN ('COLLECTED','RECEIVED_AT_RUDRA','PACKED','DISPATCHED','EXTERNAL_RECEIPT_RECORDED','EXCEPTION','RECOLLECTION_REQUIRED')),
  identity_check_confirmed boolean NOT NULL, collection_procedure_approval_id uuid NOT NULL,
  collected_by_staff_id uuid NOT NULL, collected_at timestamptz NOT NULL DEFAULT now(),
  received_by_staff_id uuid, received_at timestamptz, receiving_procedure_approval_id uuid,
  dispatch_batch_id uuid, version_number integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, specimen_number), UNIQUE (organization_id, idempotency_key), UNIQUE (id, organization_id, centre_id),
  FOREIGN KEY (job_id, organization_id, centre_id) REFERENCES collection_jobs(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (order_id, organization_id, centre_id) REFERENCES diagnostic_orders(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (patient_id, organization_id, centre_id) REFERENCES patients(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (collection_procedure_approval_id, organization_id, centre_id) REFERENCES sample_procedure_approvals(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (receiving_procedure_approval_id, organization_id, centre_id) REFERENCES sample_procedure_approvals(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (collected_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (received_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CHECK ((status IN ('COLLECTED','EXCEPTION','RECOLLECTION_REQUIRED') AND received_at IS NULL) OR (status NOT IN ('COLLECTED','EXCEPTION','RECOLLECTION_REQUIRED') AND received_at IS NOT NULL)),
  CHECK (identity_check_confirmed = true)
);
CREATE INDEX specimens_status_idx ON specimens(organization_id, centre_id, status, collected_at);
CREATE INDEX specimens_order_idx ON specimens(organization_id, order_id);

CREATE TABLE dispatch_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, centre_id uuid NOT NULL,
  batch_number varchar(32) NOT NULL, status varchar(20) NOT NULL CHECK (status IN ('PREPARING','DISPATCHED','RECEIPT_RECORDED','EXCEPTION')),
  carrier_reference varchar(200), external_lab_reference varchar(200), handed_over_by_staff_id uuid,
  handed_over_at timestamptz, transport_procedure_approval_id uuid, version_number integer NOT NULL DEFAULT 1, created_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, batch_number), UNIQUE (id, organization_id, centre_id),
  FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (handed_over_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (transport_procedure_approval_id, organization_id, centre_id) REFERENCES sample_procedure_approvals(id, organization_id, centre_id) ON DELETE RESTRICT,
  CHECK ((status = 'PREPARING' AND handed_over_at IS NULL) OR (status <> 'PREPARING' AND handed_over_at IS NOT NULL))
);

ALTER TABLE specimens ADD CONSTRAINT specimens_dispatch_batch_fk FOREIGN KEY (dispatch_batch_id, organization_id, centre_id) REFERENCES dispatch_batches(id, organization_id, centre_id) ON DELETE RESTRICT;
CREATE TABLE dispatch_batch_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, centre_id uuid NOT NULL, batch_id uuid NOT NULL, specimen_id uuid NOT NULL,
  added_by_staff_id uuid NOT NULL, added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (batch_id, specimen_id), UNIQUE (specimen_id),
  FOREIGN KEY (batch_id, organization_id, centre_id) REFERENCES dispatch_batches(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (specimen_id, organization_id, centre_id) REFERENCES specimens(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (added_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE sample_custody_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, centre_id uuid NOT NULL, specimen_id uuid NOT NULL,
  event_type varchar(32) NOT NULL CHECK (event_type IN ('COLLECTED','RECEIVED_AT_RUDRA','PACKED','DISPATCHED','EXTERNAL_RECEIPT_RECORDED','EXCEPTION_RECORDED','RECOLLECTION_REQUESTED','CORRECTION_RECORDED')),
  source varchar(24) NOT NULL CHECK (source IN ('STAFF_RECORDED','EXTERNAL_EVIDENCE','SYSTEM')),
  evidence_reference varchar(200), reason varchar(240) NOT NULL, actor_staff_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (specimen_id, organization_id, centre_id) REFERENCES specimens(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX sample_custody_events_idx ON sample_custody_events(organization_id, specimen_id, recorded_at);

CREATE TABLE sample_external_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, centre_id uuid NOT NULL, batch_id uuid NOT NULL,
  receipt_reference varchar(200) NOT NULL, evidence_reference varchar(200) NOT NULL,
  verification_status varchar(20) NOT NULL CHECK (verification_status IN ('PENDING_REVIEW','MANUALLY_VERIFIED','REJECTED')),
  recorded_by_staff_id uuid NOT NULL, verified_by_staff_id uuid, recorded_at timestamptz NOT NULL DEFAULT now(), verified_at timestamptz,
  FOREIGN KEY (batch_id, organization_id, centre_id) REFERENCES dispatch_batches(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (recorded_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (verified_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CHECK ((verification_status = 'MANUALLY_VERIFIED' AND verified_by_staff_id IS NOT NULL AND verified_at IS NOT NULL) OR verification_status <> 'MANUALLY_VERIFIED')
);
CREATE TABLE sample_exceptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, centre_id uuid NOT NULL, specimen_id uuid NOT NULL,
  exception_type varchar(32) NOT NULL CHECK (exception_type IN ('PATIENT_UNAVAILABLE','UNSUCCESSFUL_ATTEMPT','MISSING_LABEL','DAMAGED','MISSING_SPECIMEN','HANDOVER_DISCREPANCY','REJECTED','OTHER')),
  reason varchar(240) NOT NULL, status varchar(16) NOT NULL CHECK (status IN ('OPEN','RESOLVED','RECOLLECTION_REQUESTED')),
  recorded_by_staff_id uuid NOT NULL, resolved_by_staff_id uuid, resolution_reference varchar(200), created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  FOREIGN KEY (specimen_id, organization_id, centre_id) REFERENCES specimens(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (recorded_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (resolved_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);

CREATE FUNCTION sample_events_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'sample history is append-only'; END $$;
CREATE TRIGGER collection_job_events_immutable BEFORE UPDATE OR DELETE ON collection_job_events FOR EACH ROW EXECUTE FUNCTION sample_events_append_only();
CREATE TRIGGER sample_custody_events_immutable BEFORE UPDATE OR DELETE ON sample_custody_events FOR EACH ROW EXECUTE FUNCTION sample_events_append_only();
CREATE TRIGGER sample_external_receipts_immutable BEFORE UPDATE OR DELETE ON sample_external_receipts FOR EACH ROW EXECUTE FUNCTION sample_events_append_only();
CREATE TRIGGER sample_exceptions_history_immutable BEFORE DELETE ON sample_exceptions FOR EACH ROW EXECUTE FUNCTION sample_events_append_only();
CREATE TRIGGER dispatch_batch_items_immutable BEFORE UPDATE OR DELETE ON dispatch_batch_items FOR EACH ROW EXECUTE FUNCTION sample_events_append_only();
CREATE TRIGGER protect_collection_job_delete BEFORE DELETE ON collection_jobs FOR EACH ROW EXECUTE FUNCTION sample_events_append_only();
CREATE TRIGGER protect_specimen_delete BEFORE DELETE ON specimens FOR EACH ROW EXECUTE FUNCTION sample_events_append_only();

INSERT INTO permissions (key, description, scope) VALUES
 ('collections.read','View collection operations in authorized centres','CENTRE'),
 ('collections.assign','Create and assign collection jobs','CENTRE'),
 ('collections.visit.record','Record assigned collection visits','CENTRE'),
 ('samples.read','View specimen records and custody history','CENTRE'),
 ('samples.collect','Record verified specimen collection','CENTRE'),
 ('samples.receive','Receive specimens at Rudra','CENTRE'),
 ('samples.dispatch','Pack and dispatch specimens','CENTRE'),
 ('samples.external.verify','Record reviewed external receipt evidence','CENTRE'),
 ('samples.exceptions.manage','Record and reconcile sample exceptions','CENTRE'),
 ('samples.recollection.authorize','Authorize a recollection under an approved procedure','CENTRE'),
 ('samples.procedures.manage','Record approved handling procedure references','CENTRE')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.key = ANY(CASE r.key
 WHEN 'owner_super_admin' THEN ARRAY['collections.read','collections.assign','collections.visit.record','samples.read','samples.collect','samples.receive','samples.dispatch','samples.external.verify','samples.exceptions.manage','samples.recollection.authorize','samples.procedures.manage']
 WHEN 'administrator' THEN ARRAY['collections.read','collections.assign','collections.visit.record','samples.read','samples.collect','samples.receive','samples.dispatch','samples.external.verify','samples.exceptions.manage','samples.recollection.authorize','samples.procedures.manage']
 WHEN 'centre_manager' THEN ARRAY['collections.read','collections.assign','collections.visit.record','samples.read','samples.collect','samples.receive','samples.dispatch','samples.external.verify','samples.exceptions.manage','samples.recollection.authorize','samples.procedures.manage']
 WHEN 'receptionist' THEN ARRAY['collections.read','collections.assign','samples.read']
 WHEN 'phlebotomist' THEN ARRAY['collections.read','collections.visit.record','samples.read','samples.collect','samples.exceptions.manage']
 WHEN 'laboratory_branch_operations' THEN ARRAY['collections.read','samples.read','samples.receive','samples.dispatch','samples.external.verify','samples.exceptions.manage']
 WHEN 'read_only_auditor' THEN ARRAY['collections.read','samples.read']
 ELSE ARRAY[]::text[] END)
ON CONFLICT (role_id,permission_id) DO NOTHING;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app') THEN
  REVOKE DELETE ON collection_jobs, collection_job_events, sample_procedure_approvals, specimens, dispatch_batches, dispatch_batch_items, sample_custody_events, sample_external_receipts, sample_exceptions FROM rudra_dev_app;
  REVOKE UPDATE, DELETE ON collection_job_events, sample_custody_events, sample_external_receipts, dispatch_batch_items FROM rudra_dev_app;
 END IF;
END $$;

COMMENT ON TABLE sample_custody_events IS 'Append-only specimen custody history; external milestones are recorded only from referenced evidence.';
COMMENT ON TABLE sample_procedure_approvals IS 'Centre-scoped references to approved operating procedures; no clinical procedure content is embedded in the application.';
