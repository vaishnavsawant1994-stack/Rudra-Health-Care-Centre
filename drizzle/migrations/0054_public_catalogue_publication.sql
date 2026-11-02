ALTER TABLE diagnostic_catalogue_items
  ADD COLUMN public_visible boolean NOT NULL DEFAULT false,
  ADD COLUMN public_visibility_updated_at timestamptz,
  ADD COLUMN public_visibility_updated_by_staff_id uuid;

ALTER TABLE diagnostic_catalogue_items
  ADD CONSTRAINT diagnostic_catalogue_items_public_actor_fk
  FOREIGN KEY (public_visibility_updated_by_staff_id, organization_id)
  REFERENCES staff_users (id, organization_id)
  ON DELETE RESTRICT;

CREATE INDEX diagnostic_catalogue_public_idx
  ON diagnostic_catalogue_items (centre_id, public_visible, active);
