ALTER TABLE website_content_pages
  ADD COLUMN review_status varchar(24) NOT NULL DEFAULT 'NOT_SUBMITTED',
  ADD COLUMN review_version integer,
  ADD COLUMN review_submitted_by_staff_id uuid,
  ADD COLUMN review_decided_by_staff_id uuid,
  ADD COLUMN review_decided_at timestamptz;

ALTER TABLE website_content_pages
  ADD CONSTRAINT website_content_review_status_check
    CHECK (review_status IN ('NOT_SUBMITTED', 'PENDING', 'APPROVED', 'CHANGES_REQUESTED')),
  ADD CONSTRAINT website_content_review_version_check
    CHECK (review_version IS NULL OR review_version > 0),
  ADD CONSTRAINT website_content_review_shape_check
    CHECK (
      (review_status = 'NOT_SUBMITTED' AND review_version IS NULL AND review_submitted_by_staff_id IS NULL AND review_decided_by_staff_id IS NULL AND review_decided_at IS NULL)
      OR (review_status = 'PENDING' AND review_version = draft_version AND review_submitted_by_staff_id IS NOT NULL AND review_decided_by_staff_id IS NULL AND review_decided_at IS NULL)
      OR (review_status = 'CHANGES_REQUESTED' AND review_version = draft_version AND review_submitted_by_staff_id IS NOT NULL AND review_decided_by_staff_id IS NOT NULL AND review_decided_at IS NOT NULL)
      OR (review_status = 'APPROVED' AND review_version IS NOT NULL AND review_submitted_by_staff_id IS NOT NULL)
    ),
  ADD CONSTRAINT website_content_review_submitter_fk FOREIGN KEY (review_submitted_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  ADD CONSTRAINT website_content_review_decider_fk FOREIGN KEY (review_decided_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT;

-- A previously published version was explicitly published by an authorized actor.
-- Preserve that existing publication as approved, but do not approve a newer draft.
UPDATE website_content_pages
SET review_status = 'APPROVED', review_version = published_version,
    review_submitted_by_staff_id = created_by_staff_id
WHERE published_version IS NOT NULL;

ALTER TABLE website_content_events
  ALTER COLUMN event_type TYPE varchar(32),
  DROP CONSTRAINT website_content_events_event_type_check,
  ADD CONSTRAINT website_content_events_event_type_check
    CHECK (event_type IN ('DRAFT_SAVED', 'PUBLISHED', 'UNPUBLISHED', 'REVIEW_SUBMITTED', 'REVIEW_APPROVED', 'REVIEW_CHANGES_REQUESTED'));

INSERT INTO permissions(key, description, scope)
VALUES ('website.content.review', 'Independently review public website content drafts', 'ORGANIZATION')
ON CONFLICT(key) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.key IN ('owner_super_admin', 'administrator') AND p.key = 'website.content.review'
ON CONFLICT(role_id, permission_id) DO NOTHING;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN
    GRANT SELECT, UPDATE ON website_content_pages TO rudra_dev_app;
  END IF;
END $$;

COMMENT ON COLUMN website_content_pages.review_status IS 'Editorial workflow state only; it does not establish clinical, legal, pricing, or franchise approval.';
COMMENT ON COLUMN website_content_pages.review_version IS 'Draft version reviewed; any new draft invalidates this review for publication.';
