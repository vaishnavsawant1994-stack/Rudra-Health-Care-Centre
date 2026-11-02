CREATE TABLE website_content_pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  slug varchar(48) NOT NULL,
  draft_ciphertext text NOT NULL,
  published_ciphertext text,
  draft_version integer NOT NULL DEFAULT 1 CHECK (draft_version > 0),
  published_version integer,
  published_at timestamptz,
  created_by_staff_id uuid NOT NULL,
  updated_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_content_slug_uq UNIQUE (organization_id, slug),
  CONSTRAINT website_content_pages_scope_uq UNIQUE (id, organization_id),
  CONSTRAINT website_content_slug_allowed CHECK (slug IN ('home', 'about', 'home-collection', 'faq')),
  CONSTRAINT website_content_creator_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT website_content_updater_fk FOREIGN KEY (updated_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT website_content_publication_state CHECK (
    (published_ciphertext IS NULL AND published_version IS NULL AND published_at IS NULL)
    OR (published_ciphertext IS NOT NULL AND published_version IS NOT NULL AND published_at IS NOT NULL)
  )
);

CREATE TABLE website_content_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  page_id uuid NOT NULL,
  event_type varchar(16) NOT NULL CHECK (event_type IN ('DRAFT_SAVED', 'PUBLISHED', 'UNPUBLISHED')),
  event_ciphertext text NOT NULL,
  actor_staff_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_content_event_page_fk FOREIGN KEY (page_id, organization_id) REFERENCES website_content_pages(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT website_content_event_actor_fk FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX website_content_pages_published_idx ON website_content_pages(organization_id, slug) WHERE published_ciphertext IS NOT NULL;
CREATE INDEX website_content_events_history_idx ON website_content_events(organization_id, page_id, recorded_at, id);
CREATE FUNCTION prevent_website_content_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'website content history is append-only'; END $$;
CREATE TRIGGER website_content_events_append_only BEFORE UPDATE OR DELETE ON website_content_events FOR EACH ROW EXECUTE FUNCTION prevent_website_content_event_mutation();

INSERT INTO permissions(key, description, scope) VALUES
 ('website.content.manage', 'Create and edit structured public website content drafts', 'ORGANIZATION'),
 ('website.content.publish', 'Publish or unpublish approved public website content', 'ORGANIZATION')
ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE (r.key = 'owner_super_admin' AND p.key IN ('website.content.manage', 'website.content.publish'))
   OR (r.key = 'administrator' AND p.key = 'website.content.manage')
ON CONFLICT(role_id, permission_id) DO NOTHING;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app') THEN
  GRANT SELECT, INSERT, UPDATE ON website_content_pages TO rudra_dev_app;
  REVOKE DELETE ON website_content_pages FROM rudra_dev_app;
  GRANT SELECT, INSERT ON website_content_events TO rudra_dev_app;
  REVOKE UPDATE, DELETE ON website_content_events FROM rudra_dev_app;
 END IF;
END $$;
