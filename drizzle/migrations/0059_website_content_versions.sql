CREATE TABLE website_content_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  page_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  content_ciphertext text NOT NULL,
  actor_staff_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT website_content_versions_page_fk FOREIGN KEY (page_id, organization_id) REFERENCES website_content_pages(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT website_content_versions_actor_fk FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT website_content_versions_version_uq UNIQUE (page_id, version_number)
);
CREATE INDEX website_content_versions_history_idx ON website_content_versions(organization_id, page_id, version_number DESC);
CREATE FUNCTION prevent_website_content_version_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'website content versions are append-only'; END $$;
CREATE TRIGGER website_content_versions_append_only BEFORE UPDATE OR DELETE ON website_content_versions FOR EACH ROW EXECUTE FUNCTION prevent_website_content_version_mutation();

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app') THEN
  GRANT SELECT, INSERT ON website_content_versions TO rudra_dev_app;
  REVOKE UPDATE, DELETE ON website_content_versions FROM rudra_dev_app;
 END IF;
END $$;
