-- Dedicated operational escalations. Source references are validated by the
-- application against the caller's source-domain permissions and centre.
CREATE TABLE staff_escalations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  centre_id uuid NOT NULL,
  escalation_number varchar(32) NOT NULL,
  source_type varchar(24) NOT NULL CHECK (source_type IN ('APPOINTMENT','LEAD','COLLECTION_JOB','SAMPLE_EXCEPTION','REPORT','REPORT_FOLLOWUP')),
  source_id uuid NOT NULL,
  private_data_ciphertext text NOT NULL,
  severity varchar(12) NOT NULL CHECK (severity IN ('LOW','MODERATE','HIGH','URGENT')),
  priority varchar(12) NOT NULL CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status varchar(16) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ACKNOWLEDGED','RESOLVED','CANCELLED')),
  assigned_owner_staff_id uuid NOT NULL,
  created_by_staff_id uuid NOT NULL,
  due_at timestamptz NOT NULL,
  resolved_by_staff_id uuid,
  resolved_at timestamptz,
  idempotency_key uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_escalations_centre_fk FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT staff_escalations_owner_fk FOREIGN KEY (assigned_owner_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT staff_escalations_creator_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT staff_escalations_resolver_fk FOREIGN KEY (resolved_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT staff_escalations_resolution_state CHECK ((status = 'RESOLVED' AND resolved_by_staff_id IS NOT NULL AND resolved_at IS NOT NULL) OR (status <> 'RESOLVED' AND resolved_by_staff_id IS NULL AND resolved_at IS NULL)),
  UNIQUE (organization_id, escalation_number),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (id, organization_id, centre_id)
);
CREATE INDEX staff_escalations_queue_idx ON staff_escalations (organization_id, centre_id, status, due_at, severity);
CREATE INDEX staff_escalations_owner_idx ON staff_escalations (organization_id, assigned_owner_staff_id, status, due_at);

CREATE TABLE staff_escalation_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  escalation_id uuid NOT NULL,
  event_type varchar(20) NOT NULL CHECK (event_type IN ('CREATED','ACKNOWLEDGED','UPDATED','REASSIGNED','COMMENTED','RESOLVED','REOPENED','CANCELLED')),
  private_data_ciphertext text NOT NULL,
  actor_staff_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (escalation_id, organization_id, centre_id) REFERENCES staff_escalations(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX staff_escalation_events_history_idx ON staff_escalation_events (organization_id, escalation_id, recorded_at);
CREATE FUNCTION prevent_staff_escalation_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'staff escalation history is append-only'; END $$;
CREATE TRIGGER staff_escalation_events_append_only BEFORE UPDATE OR DELETE ON staff_escalation_events FOR EACH ROW EXECUTE FUNCTION prevent_staff_escalation_event_mutation();

INSERT INTO permissions(key, description, scope) VALUES
 ('escalations.read','View operational escalations in authorized centres','CENTRE'),
 ('escalations.assigned.read','View operational escalations assigned to the signed-in staff member','CENTRE'),
 ('escalations.create','Create an operational escalation in an authorized centre','CENTRE'),
 ('escalations.manage','Assign and manage centre operational escalations','CENTRE')
ON CONFLICT(key) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = ANY(CASE r.key
 WHEN 'owner_super_admin' THEN ARRAY['escalations.read','escalations.assigned.read','escalations.create','escalations.manage']
 WHEN 'administrator' THEN ARRAY['escalations.read','escalations.assigned.read','escalations.create','escalations.manage']
 WHEN 'centre_manager' THEN ARRAY['escalations.read','escalations.assigned.read','escalations.create','escalations.manage']
 WHEN 'receptionist' THEN ARRAY['escalations.assigned.read','escalations.create']
 WHEN 'phlebotomist' THEN ARRAY['escalations.assigned.read','escalations.create']
 WHEN 'laboratory_branch_operations' THEN ARRAY['escalations.assigned.read','escalations.create']
 WHEN 'accounts' THEN ARRAY['escalations.assigned.read','escalations.create']
 WHEN 'customer_support' THEN ARRAY['escalations.assigned.read','escalations.create']
 WHEN 'sales_marketing' THEN ARRAY['escalations.assigned.read','escalations.create']
 WHEN 'read_only_auditor' THEN ARRAY['escalations.read']
 ELSE ARRAY[]::text[] END)
ON CONFLICT(role_id, permission_id) DO NOTHING;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app') THEN
  GRANT SELECT, INSERT, UPDATE ON staff_escalations TO rudra_dev_app;
  GRANT SELECT, INSERT ON staff_escalation_events TO rudra_dev_app;
  REVOKE DELETE ON staff_escalations FROM rudra_dev_app;
  REVOKE UPDATE, DELETE ON staff_escalation_events FROM rudra_dev_app;
 END IF;
END $$;
