CREATE TABLE appointment_arrival_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  arrival_source varchar(20) NOT NULL DEFAULT 'FRONT_DESK' CHECK (arrival_source = 'FRONT_DESK'),
  actor_staff_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  arrived_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_arrival_scope_fk FOREIGN KEY (appointment_id, organization_id, centre_id) REFERENCES appointments(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT appointment_arrival_actor_fk FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT appointment_arrival_once_uq UNIQUE (organization_id, appointment_id),
  CONSTRAINT appointment_arrival_idempotency_uq UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX appointment_arrivals_centre_time_idx ON appointment_arrival_events (organization_id, centre_id, arrived_at DESC);
CREATE TRIGGER appointment_arrival_events_append_only BEFORE UPDATE OR DELETE ON appointment_arrival_events FOR EACH ROW EXECUTE FUNCTION prevent_appointment_history_mutation();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN
    GRANT SELECT, INSERT ON appointment_arrival_events TO rudra_dev_app;
    REVOKE UPDATE, DELETE ON appointment_arrival_events FROM rudra_dev_app;
  END IF;
END $$;

COMMENT ON TABLE appointment_arrival_events IS 'Append-only front-desk arrival/check-in confirmation; does not imply service completion or sample collection.';
