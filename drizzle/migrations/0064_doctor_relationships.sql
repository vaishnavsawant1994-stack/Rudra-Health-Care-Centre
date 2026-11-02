CREATE TABLE doctor_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  centre_id uuid NOT NULL,
  doctor_number varchar(28) NOT NULL,
  specialty varchar(100) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  private_data_ciphertext text NOT NULL,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  created_by_staff_id uuid NOT NULL,
  updated_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT doctor_profiles_id_org_centre_uq UNIQUE(id, organization_id, centre_id),
  CONSTRAINT doctor_profiles_number_uq UNIQUE(organization_id, doctor_number),
  CONSTRAINT doctor_profiles_centre_fk FOREIGN KEY(centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT doctor_profiles_creator_fk FOREIGN KEY(created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT doctor_profiles_updater_fk FOREIGN KEY(updated_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX doctor_profiles_directory_idx ON doctor_profiles(organization_id, centre_id, status, specialty, created_at DESC);

CREATE TABLE doctor_relationship_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  doctor_id uuid NOT NULL,
  event_type varchar(24) NOT NULL CHECK (event_type IN ('CREATED','UPDATED','STATUS_CHANGED','REFERRAL_RECORDED')),
  private_data_ciphertext text NOT NULL,
  actor_staff_id uuid NOT NULL,
  idempotency_key uuid,
  request_hash varchar(64),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT doctor_relationship_events_profile_fk FOREIGN KEY(doctor_id, organization_id, centre_id) REFERENCES doctor_profiles(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT doctor_relationship_events_actor_fk FOREIGN KEY(actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT doctor_relationship_events_idempotency_uq UNIQUE(organization_id, idempotency_key),
  CONSTRAINT doctor_relationship_events_idempotency_pair CHECK ((idempotency_key IS NULL) = (request_hash IS NULL))
);
CREATE INDEX doctor_relationship_events_history_idx ON doctor_relationship_events(organization_id, centre_id, doctor_id, recorded_at, id);
CREATE FUNCTION prevent_doctor_relationship_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'doctor relationship history is append-only'; END $$;
CREATE TRIGGER doctor_relationship_events_append_only BEFORE UPDATE OR DELETE ON doctor_relationship_events FOR EACH ROW EXECUTE FUNCTION prevent_doctor_relationship_event_mutation();

INSERT INTO permissions(key, description, scope) VALUES
 ('doctors.read', 'View doctor relationship records within authorized centres', 'CENTRE'),
 ('doctors.manage', 'Create and update doctor relationship records within authorized centres', 'CENTRE')
ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE (r.key IN ('owner_super_admin','administrator','centre_manager','sales_marketing') AND p.key IN ('doctors.read','doctors.manage'))
ON CONFLICT(role_id, permission_id) DO NOTHING;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app') THEN
  GRANT SELECT, INSERT, UPDATE ON doctor_profiles TO rudra_dev_app;
  REVOKE DELETE ON doctor_profiles FROM rudra_dev_app;
  GRANT SELECT, INSERT ON doctor_relationship_events TO rudra_dev_app;
  REVOKE UPDATE, DELETE ON doctor_relationship_events FROM rudra_dev_app;
 END IF;
END $$;
