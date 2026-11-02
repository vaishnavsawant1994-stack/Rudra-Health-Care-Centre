CREATE TABLE marketing_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  campaign_code varchar(32) NOT NULL,
  channel varchar(20) NOT NULL CHECK (channel IN ('WEBSITE','REFERRAL','PHONE','WALK_IN','PRINT','SOCIAL','OTHER')),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','ACTIVE','COMPLETED','CANCELLED')),
  starts_on date,
  ends_on date,
  private_data_ciphertext text NOT NULL,
  created_by_staff_id uuid NOT NULL,
  updated_by_staff_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_campaign_code_uq UNIQUE (organization_id, centre_id, campaign_code),
  CONSTRAINT marketing_campaign_id_scope_uq UNIQUE (id, organization_id, centre_id),
  CONSTRAINT marketing_campaign_idempotency_uq UNIQUE (organization_id, idempotency_key),
  CONSTRAINT marketing_campaign_centre_fk FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT marketing_campaign_creator_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT marketing_campaign_updater_fk FOREIGN KEY (updated_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT marketing_campaign_dates_check CHECK (starts_on IS NULL OR ends_on IS NULL OR ends_on >= starts_on)
);
CREATE INDEX marketing_campaign_queue_idx ON marketing_campaigns(organization_id, centre_id, status, updated_at DESC);

CREATE TABLE marketing_campaign_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  campaign_id uuid NOT NULL,
  actor_staff_id uuid NOT NULL,
  event_type varchar(16) NOT NULL CHECK (event_type IN ('CREATED','UPDATED','ACTIVATED','COMPLETED','CANCELLED')),
  private_data_ciphertext text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_campaign_event_campaign_fk FOREIGN KEY (campaign_id, organization_id, centre_id) REFERENCES marketing_campaigns(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT marketing_campaign_event_actor_fk FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT marketing_campaign_event_idempotency_uq UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX marketing_campaign_event_history_idx ON marketing_campaign_events(organization_id, campaign_id, recorded_at, id);
CREATE OR REPLACE FUNCTION prevent_marketing_campaign_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'marketing_campaign_events_are_append_only'; END $$;
CREATE TRIGGER marketing_campaign_events_append_only BEFORE UPDATE OR DELETE ON marketing_campaign_events FOR EACH ROW EXECUTE FUNCTION prevent_marketing_campaign_event_mutation();

ALTER TABLE leads ADD COLUMN marketing_campaign_id uuid;
ALTER TABLE leads ADD CONSTRAINT leads_marketing_campaign_scope_fk FOREIGN KEY (marketing_campaign_id, organization_id, centre_id)
  REFERENCES marketing_campaigns(id, organization_id, centre_id) ON DELETE RESTRICT;
CREATE INDEX leads_marketing_campaign_idx ON leads(organization_id, centre_id, marketing_campaign_id) WHERE marketing_campaign_id IS NOT NULL;

INSERT INTO permissions (key, description, scope)
VALUES ('marketing.read', 'View internal campaign records in authorized centres', 'CENTRE'),
       ('marketing.manage', 'Create and manage internal campaign records in authorized centres', 'CENTRE')
ON CONFLICT (key) DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key IN ('marketing.read','marketing.manage')
WHERE r.key IN ('owner_super_admin','administrator','sales_marketing')
ON CONFLICT DO NOTHING;
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = 'marketing.read'
WHERE r.key = 'centre_manager'
ON CONFLICT DO NOTHING;

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN
  GRANT SELECT, INSERT, UPDATE ON marketing_campaigns TO rudra_dev_app;
  GRANT SELECT, INSERT ON marketing_campaign_events TO rudra_dev_app;
  GRANT SELECT, UPDATE ON leads TO rudra_dev_app;
  REVOKE DELETE ON marketing_campaigns, marketing_campaign_events FROM rudra_dev_app;
  REVOKE UPDATE, DELETE ON marketing_campaign_events FROM rudra_dev_app;
END IF; END $$;
COMMENT ON TABLE marketing_campaigns IS 'Internal centre-scoped marketing campaign attribution registry. No publishing, messaging, or spend is performed.';
COMMENT ON COLUMN marketing_campaigns.private_data_ciphertext IS 'Authenticated encrypted campaign name and internal description.';
