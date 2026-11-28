CREATE TABLE metropolis_reference_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  order_id uuid NOT NULL,
  specimen_id uuid,
  reference_type varchar(16) NOT NULL CHECK (reference_type IN ('ORDER','PATIENT','SPECIMEN')),
  reference_blind_index varchar(64) NOT NULL CHECK (reference_blind_index ~ '^[a-f0-9]{64}$'),
  private_data_ciphertext text NOT NULL,
  idempotency_key uuid NOT NULL,
  recorded_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT metropolis_reference_order_fk FOREIGN KEY (order_id, organization_id, centre_id) REFERENCES diagnostic_orders(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT metropolis_reference_specimen_fk FOREIGN KEY (specimen_id, organization_id, centre_id) REFERENCES specimens(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT metropolis_reference_actor_fk FOREIGN KEY (recorded_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT metropolis_reference_value_uq UNIQUE (organization_id, reference_blind_index),
  CONSTRAINT metropolis_reference_idempotency_uq UNIQUE (organization_id, idempotency_key),
  CONSTRAINT metropolis_reference_specimen_type CHECK ((reference_type = 'SPECIMEN' AND specimen_id IS NOT NULL) OR reference_type <> 'SPECIMEN')
);
CREATE INDEX metropolis_reference_order_idx ON metropolis_reference_mappings(organization_id, centre_id, order_id, created_at DESC);

CREATE TABLE metropolis_status_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  order_id uuid NOT NULL,
  specimen_id uuid,
  status_code varchar(32) NOT NULL CHECK (status_code IN ('SAMPLE_RECEIVED','SAMPLE_REGISTERED','PROCESSING_STARTED','PROCESSING_COMPLETE','REPORT_PENDING','REPORT_AVAILABLE','SAMPLE_REJECTED','OTHER')),
  occurred_at timestamptz NOT NULL,
  supersedes_event_id uuid,
  private_data_ciphertext text NOT NULL,
  idempotency_key uuid NOT NULL,
  actor_staff_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT metropolis_status_order_fk FOREIGN KEY (order_id, organization_id, centre_id) REFERENCES diagnostic_orders(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT metropolis_status_specimen_fk FOREIGN KEY (specimen_id, organization_id, centre_id) REFERENCES specimens(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT metropolis_status_scope_uq UNIQUE (id, organization_id, centre_id),
  CONSTRAINT metropolis_status_idempotency_uq UNIQUE (organization_id, idempotency_key),
  CONSTRAINT metropolis_status_actor_fk FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT metropolis_status_supersedes_fk FOREIGN KEY (supersedes_event_id, organization_id, centre_id) REFERENCES metropolis_status_events(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT metropolis_status_not_self CHECK (supersedes_event_id IS NULL OR supersedes_event_id <> id)
);
CREATE INDEX metropolis_status_order_idx ON metropolis_status_events(organization_id, centre_id, order_id, recorded_at DESC);
CREATE UNIQUE INDEX metropolis_status_superseded_uq ON metropolis_status_events(organization_id, supersedes_event_id) WHERE supersedes_event_id IS NOT NULL;

CREATE TABLE metropolis_status_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  status_event_id uuid NOT NULL,
  decision varchar(12) NOT NULL CHECK (decision IN ('VERIFIED','DISPUTED')),
  private_data_ciphertext text NOT NULL,
  idempotency_key uuid NOT NULL,
  reviewer_staff_id uuid NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT metropolis_status_review_event_fk FOREIGN KEY (status_event_id, organization_id, centre_id) REFERENCES metropolis_status_events(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT metropolis_status_review_idempotency_uq UNIQUE (organization_id, idempotency_key),
  CONSTRAINT metropolis_status_review_event_uq UNIQUE (organization_id, status_event_id),
  CONSTRAINT metropolis_status_reviewer_fk FOREIGN KEY (reviewer_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX metropolis_status_review_event_idx ON metropolis_status_reviews(organization_id, status_event_id, reviewed_at DESC);

CREATE TRIGGER metropolis_reference_immutable BEFORE UPDATE OR DELETE ON metropolis_reference_mappings FOR EACH ROW EXECUTE FUNCTION sample_events_append_only();
CREATE TRIGGER metropolis_status_immutable BEFORE UPDATE OR DELETE ON metropolis_status_events FOR EACH ROW EXECUTE FUNCTION sample_events_append_only();
CREATE TRIGGER metropolis_status_review_immutable BEFORE UPDATE OR DELETE ON metropolis_status_reviews FOR EACH ROW EXECUTE FUNCTION sample_events_append_only();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app') THEN
    GRANT SELECT, INSERT ON metropolis_reference_mappings, metropolis_status_events, metropolis_status_reviews TO rudra_dev_app;
    REVOKE UPDATE, DELETE ON metropolis_reference_mappings, metropolis_status_events, metropolis_status_reviews FROM rudra_dev_app;
  END IF;
END $$;

COMMENT ON TABLE metropolis_reference_mappings IS 'Encrypted manual mappings for external diagnostic references. A keyed blind index prevents organization-wide duplicate external references without storing them in plaintext.';
COMMENT ON TABLE metropolis_status_events IS 'Append-only staff-recorded external status statements; these are not provider-confirmed events.';
COMMENT ON TABLE metropolis_status_reviews IS 'Append-only second-person review evidence for staff-recorded external status statements.';
