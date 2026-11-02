CREATE TABLE appointment_queue_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  queue_date date NOT NULL,
  token_number integer NOT NULL CHECK (token_number > 0),
  status varchar(12) NOT NULL DEFAULT 'WAITING' CHECK (status IN ('WAITING', 'CALLED')),
  actor_staff_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  issued_at timestamptz NOT NULL DEFAULT now(),
  called_at timestamptz,
  CONSTRAINT appointment_queue_scope_fk FOREIGN KEY (appointment_id, organization_id, centre_id)
    REFERENCES appointments(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT appointment_queue_actor_fk FOREIGN KEY (actor_staff_id, organization_id)
    REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT appointment_queue_token_number_uq UNIQUE (organization_id, centre_id, queue_date, token_number),
  CONSTRAINT appointment_queue_appointment_uq UNIQUE (organization_id, appointment_id),
  CONSTRAINT appointment_queue_idempotency_uq UNIQUE (organization_id, idempotency_key),
  CONSTRAINT appointment_queue_id_org_centre_uq UNIQUE (id, organization_id, centre_id)
);
CREATE INDEX appointment_queue_centre_day_idx ON appointment_queue_tokens (organization_id, centre_id, queue_date, status, token_number);

CREATE TABLE appointment_queue_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  queue_token_id uuid NOT NULL,
  event_type varchar(12) NOT NULL CHECK (event_type IN ('ISSUED', 'CALLED')),
  actor_staff_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_queue_event_token_fk FOREIGN KEY (queue_token_id, organization_id, centre_id)
    REFERENCES appointment_queue_tokens(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT appointment_queue_event_actor_fk FOREIGN KEY (actor_staff_id, organization_id)
    REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE UNIQUE INDEX appointment_queue_event_once_uq ON appointment_queue_events (queue_token_id, event_type);
CREATE UNIQUE INDEX appointment_queue_event_idempotency_uq ON appointment_queue_events (organization_id, idempotency_key);
CREATE INDEX appointment_queue_event_history_idx ON appointment_queue_events (organization_id, queue_token_id, recorded_at);
CREATE TRIGGER appointment_queue_events_append_only BEFORE UPDATE OR DELETE ON appointment_queue_events FOR EACH ROW EXECUTE FUNCTION prevent_appointment_history_mutation();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN
    GRANT SELECT, INSERT, UPDATE ON appointment_queue_tokens TO rudra_dev_app;
    GRANT SELECT, INSERT ON appointment_queue_events TO rudra_dev_app;
    REVOKE UPDATE, DELETE ON appointment_queue_events FROM rudra_dev_app;
  END IF;
END $$;

COMMENT ON TABLE appointment_queue_tokens IS 'Centre-local daily walk-in queue token for an arrived, confirmed centre appointment; queue state does not imply clinical service completion.';
COMMENT ON TABLE appointment_queue_events IS 'Append-only actor and timestamp history for walk-in token issue and call events.';
