CREATE TABLE communication_governance_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  record_kind varchar(24) NOT NULL CHECK (record_kind IN ('PROVIDER_POLICY','KNOWLEDGE')),
  channel varchar(16),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status = 'DRAFT'),
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  private_data_ciphertext text NOT NULL,
  created_by_staff_id uuid NOT NULL,
  updated_by_staff_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_governance_channel_check CHECK (
    (record_kind = 'PROVIDER_POLICY' AND channel IS NOT NULL AND channel IN ('WHATSAPP','VOICE')) OR
    (record_kind = 'KNOWLEDGE' AND channel IS NULL)
  ),
  CONSTRAINT communication_governance_id_scope_uq UNIQUE (id, organization_id, centre_id),
  CONSTRAINT communication_governance_idempotency_uq UNIQUE (organization_id, idempotency_key),
  CONSTRAINT communication_governance_centre_fk FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT communication_governance_creator_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT communication_governance_updater_fk FOREIGN KEY (updated_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX communication_governance_queue_idx ON communication_governance_records(organization_id, centre_id, record_kind, updated_at DESC);

CREATE TABLE communication_governance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  record_id uuid NOT NULL,
  actor_staff_id uuid NOT NULL,
  event_type varchar(16) NOT NULL CHECK (event_type IN ('CREATED','UPDATED')),
  private_data_ciphertext text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_governance_event_record_fk FOREIGN KEY (record_id, organization_id, centre_id) REFERENCES communication_governance_records(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT communication_governance_event_actor_fk FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT communication_governance_event_idempotency_uq UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX communication_governance_event_history_idx ON communication_governance_events(organization_id, record_id, recorded_at, id);

CREATE OR REPLACE FUNCTION prevent_communication_governance_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'communication_governance_events_are_append_only'; END $$;
CREATE TRIGGER communication_governance_events_append_only BEFORE UPDATE OR DELETE ON communication_governance_events FOR EACH ROW EXECUTE FUNCTION prevent_communication_governance_event_mutation();

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN
  GRANT SELECT, INSERT, UPDATE ON communication_governance_records TO rudra_dev_app;
  GRANT SELECT, INSERT ON communication_governance_events TO rudra_dev_app;
  REVOKE DELETE ON communication_governance_records, communication_governance_events FROM rudra_dev_app;
  REVOKE UPDATE, DELETE ON communication_governance_events FROM rudra_dev_app;
END IF; END $$;

COMMENT ON TABLE communication_governance_records IS 'Encrypted, centre-scoped draft-only provider policy and AI knowledge governance records. No provider connection, publication or delivery is activated by these records.';
COMMENT ON COLUMN communication_governance_records.status IS 'Only DRAFT is supported until external provider and qualified review gates are implemented.';
COMMENT ON TABLE communication_governance_events IS 'Append-only encrypted change snapshots for internal communications governance drafts.';
