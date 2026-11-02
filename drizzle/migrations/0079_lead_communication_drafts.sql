CREATE TABLE lead_communication_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  created_by_staff_id uuid NOT NULL,
  purpose varchar(16) NOT NULL CHECK (purpose IN ('OPERATIONAL','MARKETING')),
  channel varchar(16) NOT NULL CHECK (channel IN ('PHONE','EMAIL','WHATSAPP')),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','CANCELLED')),
  body_ciphertext text NOT NULL,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_communication_drafts_scope_fk FOREIGN KEY (lead_id, organization_id, centre_id)
    REFERENCES leads(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT lead_communication_drafts_actor_fk FOREIGN KEY (created_by_staff_id, organization_id)
    REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT lead_communication_drafts_idempotency_uq UNIQUE (organization_id, idempotency_key),
  CONSTRAINT lead_communication_drafts_id_scope_uq UNIQUE (id, organization_id, centre_id)
);
CREATE INDEX lead_communication_drafts_queue_idx ON lead_communication_drafts(organization_id, centre_id, status, created_at DESC);
CREATE INDEX lead_communication_drafts_lead_idx ON lead_communication_drafts(organization_id, lead_id, created_at DESC);

CREATE TABLE lead_communication_draft_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  draft_id uuid NOT NULL,
  actor_staff_id uuid NOT NULL,
  event_type varchar(16) NOT NULL CHECK (event_type IN ('CREATED','CANCELLED')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_communication_draft_events_draft_fk FOREIGN KEY (draft_id, organization_id, centre_id)
    REFERENCES lead_communication_drafts(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT lead_communication_draft_events_actor_fk FOREIGN KEY (actor_staff_id, organization_id)
    REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX lead_communication_draft_events_history_idx ON lead_communication_draft_events(organization_id, draft_id, recorded_at);

CREATE OR REPLACE FUNCTION prevent_lead_communication_draft_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'lead_communication_draft_events_are_append_only'; END $$;
CREATE TRIGGER lead_communication_draft_events_append_only
  BEFORE UPDATE OR DELETE ON lead_communication_draft_events
  FOR EACH ROW EXECUTE FUNCTION prevent_lead_communication_draft_event_mutation();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN
    GRANT SELECT, INSERT, UPDATE ON lead_communication_drafts TO rudra_dev_app;
    GRANT SELECT, INSERT ON lead_communication_draft_events TO rudra_dev_app;
    REVOKE DELETE ON lead_communication_drafts, lead_communication_draft_events FROM rudra_dev_app;
    REVOKE UPDATE, DELETE ON lead_communication_draft_events FROM rudra_dev_app;
  END IF;
END $$;

COMMENT ON TABLE lead_communication_drafts IS 'Encrypted staff-only message drafts. No provider dispatch or delivery claim is implemented.';
COMMENT ON COLUMN lead_communication_drafts.body_ciphertext IS 'AES-GCM encrypted operational or marketing draft; recipient details are not copied here.';
