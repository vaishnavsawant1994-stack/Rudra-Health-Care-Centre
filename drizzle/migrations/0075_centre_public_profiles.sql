CREATE TABLE centre_public_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  profile_ciphertext text NOT NULL,
  published boolean NOT NULL DEFAULT false,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  created_by_staff_id uuid NOT NULL,
  updated_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT centre_public_profiles_centre_uq UNIQUE (organization_id, centre_id),
  CONSTRAINT centre_public_profiles_id_scope_uq UNIQUE (id, organization_id, centre_id),
  CONSTRAINT centre_public_profiles_centre_fk FOREIGN KEY (centre_id, organization_id)
    REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT centre_public_profiles_creator_fk FOREIGN KEY (created_by_staff_id, organization_id)
    REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT centre_public_profiles_updater_fk FOREIGN KEY (updated_by_staff_id, organization_id)
    REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);

CREATE INDEX centre_public_profiles_public_idx
  ON centre_public_profiles (published, organization_id, centre_id);

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN
    GRANT SELECT, INSERT, UPDATE ON centre_public_profiles TO rudra_dev_app;
    REVOKE DELETE ON centre_public_profiles FROM rudra_dev_app;
  END IF;
END $$;
