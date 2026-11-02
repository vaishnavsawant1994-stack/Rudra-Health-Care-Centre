CREATE TABLE marketing_content_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  campaign_id uuid,
  channel varchar(16) NOT NULL CHECK (channel IN ('WEBSITE','SOCIAL','PRINT','EMAIL','WHATSAPP')),
  content_type varchar(16) NOT NULL CHECK (content_type IN ('POST','STORY','BANNER','MESSAGE')),
  status varchar(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','IN_REVIEW','APPROVED','SCHEDULED','CANCELLED')),
  planned_publish_at timestamptz,
  private_data_ciphertext text NOT NULL,
  created_by_staff_id uuid NOT NULL,
  updated_by_staff_id uuid NOT NULL,
  reviewed_by_staff_id uuid,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  idempotency_key uuid NOT NULL,
  request_fingerprint varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_content_id_scope_uq UNIQUE (id, organization_id, centre_id),
  CONSTRAINT marketing_content_idempotency_uq UNIQUE (organization_id, idempotency_key),
  CONSTRAINT marketing_content_centre_fk FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT marketing_content_campaign_fk FOREIGN KEY (campaign_id, organization_id, centre_id) REFERENCES marketing_campaigns(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT marketing_content_creator_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT marketing_content_updater_fk FOREIGN KEY (updated_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT marketing_content_reviewer_fk FOREIGN KEY (reviewed_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT marketing_content_schedule_check CHECK ((status = 'SCHEDULED') = (planned_publish_at IS NOT NULL)),
  CONSTRAINT marketing_content_review_check CHECK (status NOT IN ('APPROVED','SCHEDULED') OR reviewed_by_staff_id IS NOT NULL)
);
CREATE INDEX marketing_content_calendar_idx ON marketing_content_items(organization_id, centre_id, status, planned_publish_at, updated_at DESC);

CREATE TABLE marketing_content_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  content_item_id uuid NOT NULL,
  actor_staff_id uuid NOT NULL,
  event_type varchar(20) NOT NULL CHECK (event_type IN ('CREATED','UPDATED','SUBMITTED','APPROVED','CHANGES_REQUESTED','SCHEDULED','CANCELLED')),
  private_data_ciphertext text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_fingerprint varchar(64) NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT marketing_content_event_item_fk FOREIGN KEY (content_item_id, organization_id, centre_id) REFERENCES marketing_content_items(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT marketing_content_event_actor_fk FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT marketing_content_event_idempotency_uq UNIQUE (organization_id, idempotency_key)
);
CREATE INDEX marketing_content_event_history_idx ON marketing_content_events(organization_id, content_item_id, recorded_at, id);
CREATE OR REPLACE FUNCTION prevent_marketing_content_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'marketing_content_events_are_append_only'; END $$;
CREATE TRIGGER marketing_content_events_append_only BEFORE UPDATE OR DELETE ON marketing_content_events FOR EACH ROW EXECUTE FUNCTION prevent_marketing_content_event_mutation();

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN
  GRANT SELECT, INSERT, UPDATE ON marketing_content_items TO rudra_dev_app;
  GRANT SELECT, INSERT ON marketing_content_events TO rudra_dev_app;
  REVOKE DELETE ON marketing_content_items, marketing_content_events FROM rudra_dev_app;
  REVOKE UPDATE, DELETE ON marketing_content_events FROM rudra_dev_app;
END IF; END $$;
COMMENT ON TABLE marketing_content_items IS 'Private internal marketing drafts and review calendar; scheduling is planning only and has no publisher.';
COMMENT ON COLUMN marketing_content_items.private_data_ciphertext IS 'Authenticated encrypted content title, body, and internal notes.';
