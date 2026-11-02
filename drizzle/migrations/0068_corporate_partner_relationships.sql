CREATE TABLE business_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  centre_id uuid NOT NULL,
  relationship_type varchar(16) NOT NULL CHECK (relationship_type IN ('CORPORATE','PARTNER')),
  relationship_number varchar(32) NOT NULL,
  category varchar(40) NOT NULL,
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  private_data_ciphertext text NOT NULL,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  created_by_staff_id uuid NOT NULL,
  updated_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_relationships_scope_uq UNIQUE(id, organization_id, centre_id, relationship_type),
  CONSTRAINT business_relationships_number_uq UNIQUE(organization_id, relationship_type, relationship_number),
  CONSTRAINT business_relationships_centre_fk FOREIGN KEY(centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT business_relationships_creator_fk FOREIGN KEY(created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT business_relationships_updater_fk FOREIGN KEY(updated_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX business_relationships_directory_idx ON business_relationships(organization_id, centre_id, relationship_type, status, category, created_at DESC);

CREATE TABLE business_relationship_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  relationship_id uuid NOT NULL,
  relationship_type varchar(16) NOT NULL CHECK (relationship_type IN ('CORPORATE','PARTNER')),
  event_type varchar(24) NOT NULL CHECK (event_type IN ('CREATED','UPDATED','STATUS_CHANGED','ACTIVITY_RECORDED')),
  private_data_ciphertext text NOT NULL,
  actor_staff_id uuid NOT NULL,
  idempotency_key uuid,
  request_hash varchar(64),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_relationship_events_profile_fk FOREIGN KEY(relationship_id, organization_id, centre_id, relationship_type) REFERENCES business_relationships(id, organization_id, centre_id, relationship_type) ON DELETE RESTRICT,
  CONSTRAINT business_relationship_events_actor_fk FOREIGN KEY(actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT business_relationship_events_idempotency_uq UNIQUE(organization_id, idempotency_key),
  CONSTRAINT business_relationship_events_idempotency_pair CHECK ((idempotency_key IS NULL) = (request_hash IS NULL))
);
CREATE INDEX business_relationship_events_history_idx ON business_relationship_events(organization_id, centre_id, relationship_id, recorded_at, id);
CREATE FUNCTION prevent_business_relationship_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'business relationship history is append-only'; END $$;
CREATE TRIGGER business_relationship_events_append_only BEFORE UPDATE OR DELETE ON business_relationship_events FOR EACH ROW EXECUTE FUNCTION prevent_business_relationship_event_mutation();

INSERT INTO permissions(key, description, scope) VALUES
 ('corporate.read', 'View corporate relationships and authorized contacts within centres', 'CENTRE'),
 ('corporate.manage', 'Create and update corporate relationship records within centres', 'CENTRE'),
 ('partners.read', 'View partner relationships and authorized contacts within centres', 'CENTRE'),
 ('partners.manage', 'Create and update partner relationship records within centres', 'CENTRE')
ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
WHERE r.key IN ('owner_super_admin','administrator','centre_manager','sales_marketing')
  AND p.key IN ('corporate.read','corporate.manage','partners.read','partners.manage')
ON CONFLICT(role_id, permission_id) DO NOTHING;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app') THEN
  GRANT SELECT, INSERT, UPDATE ON business_relationships TO rudra_dev_app;
  REVOKE DELETE ON business_relationships FROM rudra_dev_app;
  GRANT SELECT, INSERT ON business_relationship_events TO rudra_dev_app;
  REVOKE UPDATE, DELETE ON business_relationship_events FROM rudra_dev_app;
 END IF;
END $$;
