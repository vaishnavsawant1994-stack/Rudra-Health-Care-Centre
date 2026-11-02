CREATE TABLE staff_shift_handovers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  outgoing_shift_id uuid NOT NULL,
  outgoing_staff_id uuid NOT NULL,
  incoming_staff_id uuid NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','ACKNOWLEDGED','CANCELLED')),
  private_data_ciphertext text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  version_number integer NOT NULL DEFAULT 1,
  created_by_staff_id uuid NOT NULL,
  acknowledged_by_staff_id uuid,
  acknowledged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_shift_handovers_idempotency_uq UNIQUE (organization_id, idempotency_key),
  CONSTRAINT staff_shift_handovers_scope_uq UNIQUE (id, organization_id, centre_id),
  CONSTRAINT staff_shift_handovers_shift_fk FOREIGN KEY (outgoing_shift_id, organization_id, centre_id) REFERENCES staff_shifts(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT staff_shift_handovers_outgoing_staff_fk FOREIGN KEY (outgoing_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT staff_shift_handovers_incoming_staff_fk FOREIGN KEY (incoming_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT staff_shift_handovers_creator_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT staff_shift_handovers_acknowledger_fk FOREIGN KEY (acknowledged_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT staff_shift_handovers_ack_consistency CHECK ((status = 'ACKNOWLEDGED' AND acknowledged_by_staff_id IS NOT NULL AND acknowledged_at IS NOT NULL) OR status <> 'ACKNOWLEDGED'),
  CONSTRAINT staff_shift_handovers_distinct_staff CHECK (outgoing_staff_id <> incoming_staff_id)
);
CREATE UNIQUE INDEX staff_shift_handovers_one_active_per_shift_uq ON staff_shift_handovers(organization_id, outgoing_shift_id) WHERE status <> 'CANCELLED';
CREATE INDEX staff_shift_handovers_incoming_queue_idx ON staff_shift_handovers(organization_id, centre_id, incoming_staff_id, status, created_at DESC);

CREATE TABLE staff_shift_handover_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  handover_id uuid NOT NULL,
  event_type varchar(20) NOT NULL CHECK (event_type IN ('PREPARED','ACKNOWLEDGED','CANCELLED')),
  private_data_ciphertext text NOT NULL,
  actor_staff_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_shift_handover_events_handover_fk FOREIGN KEY (handover_id, organization_id, centre_id) REFERENCES staff_shift_handovers(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT staff_shift_handover_events_actor_fk FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX staff_shift_handover_events_history_idx ON staff_shift_handover_events(organization_id, handover_id, recorded_at, id);
CREATE FUNCTION prevent_staff_shift_handover_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'staff shift handover history is append-only'; END $$;
CREATE TRIGGER staff_shift_handover_events_append_only BEFORE UPDATE OR DELETE ON staff_shift_handover_events FOR EACH ROW EXECUTE FUNCTION prevent_staff_shift_handover_event_mutation();

INSERT INTO permissions(key, description, scope) VALUES
 ('roster.handover','Prepare and acknowledge role-scoped shift handovers','CENTRE')
ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE p.key='roster.handover' AND r.key IN ('owner_super_admin','administrator','centre_manager','receptionist','phlebotomist','laboratory_branch_operations','accounts','customer_support','sales_marketing')
ON CONFLICT(role_id, permission_id) DO NOTHING;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app') THEN
  GRANT SELECT, INSERT, UPDATE ON staff_shift_handovers TO rudra_dev_app;
  GRANT SELECT, INSERT ON staff_shift_handover_events TO rudra_dev_app;
  REVOKE UPDATE, DELETE ON staff_shift_handover_events FROM rudra_dev_app;
  REVOKE DELETE ON staff_shift_handovers FROM rudra_dev_app;
 END IF;
END $$;
