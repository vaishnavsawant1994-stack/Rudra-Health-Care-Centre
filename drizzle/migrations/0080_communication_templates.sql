CREATE TABLE communication_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  created_by_staff_id uuid NOT NULL,
  updated_by_staff_id uuid NOT NULL,
  purpose varchar(16) NOT NULL CHECK (purpose IN ('OPERATIONAL','MARKETING')),
  channel varchar(16) NOT NULL CHECK (channel IN ('PHONE','EMAIL','WHATSAPP')),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  private_data_ciphertext text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_templates_creator_fk FOREIGN KEY (created_by_staff_id, organization_id)
    REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT communication_templates_updater_fk FOREIGN KEY (updated_by_staff_id, organization_id)
    REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT communication_templates_org_idempotency_uq UNIQUE (organization_id, idempotency_key),
  CONSTRAINT communication_templates_id_scope_uq UNIQUE (id, organization_id, centre_id)
);
CREATE INDEX communication_templates_queue_idx ON communication_templates(organization_id, centre_id, status, updated_at DESC);

CREATE TABLE communication_template_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  template_id uuid NOT NULL,
  actor_staff_id uuid NOT NULL,
  event_type varchar(16) NOT NULL CHECK (event_type IN ('CREATED','UPDATED','ACTIVATED','ARCHIVED')),
  private_data_ciphertext text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communication_template_events_template_fk FOREIGN KEY (template_id, organization_id, centre_id)
    REFERENCES communication_templates(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT communication_template_events_actor_fk FOREIGN KEY (actor_staff_id, organization_id)
    REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT communication_template_events_org_idempotency_uq UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX communication_template_events_history_idx ON communication_template_events(organization_id, template_id, recorded_at, id);

CREATE OR REPLACE FUNCTION prevent_communication_template_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'communication_template_events_are_append_only'; END $$;
CREATE TRIGGER communication_template_events_append_only
  BEFORE UPDATE OR DELETE ON communication_template_events
  FOR EACH ROW EXECUTE FUNCTION prevent_communication_template_event_mutation();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN
    GRANT SELECT, INSERT, UPDATE ON communication_templates TO rudra_dev_app;
    GRANT SELECT, INSERT ON communication_template_events TO rudra_dev_app;
    REVOKE DELETE ON communication_templates, communication_template_events FROM rudra_dev_app;
    REVOKE UPDATE, DELETE ON communication_template_events FROM rudra_dev_app;
  END IF;
END $$;

COMMENT ON TABLE communication_templates IS 'Encrypted, centre-scoped staff communication content. Activation is internal approval only and never sends a message.';
COMMENT ON COLUMN communication_templates.private_data_ciphertext IS 'Authenticated encrypted template name/body and approved variable names; no plaintext communication content.';
