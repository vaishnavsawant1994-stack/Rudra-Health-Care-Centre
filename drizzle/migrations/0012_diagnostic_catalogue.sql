CREATE TABLE catalogue_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  file_digest varchar(64) NOT NULL,
  row_count integer NOT NULL CHECK (row_count BETWEEN 1 AND 1000),
  created_count integer NOT NULL DEFAULT 0,
  rejected_count integer NOT NULL DEFAULT 0,
  source_reference varchar(200) NOT NULL,
  imported_by_staff_id uuid NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id, centre_id),
  FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (imported_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE diagnostic_catalogue_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  service_type varchar(12) NOT NULL CHECK (service_type IN ('TEST', 'PACKAGE')),
  service_code varchar(80) NOT NULL,
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  active boolean NOT NULL DEFAULT true,
  created_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, centre_id, service_type, service_code),
  UNIQUE (id, organization_id, centre_id),
  FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX diagnostic_catalogue_centre_type_idx ON diagnostic_catalogue_items(organization_id, centre_id, service_type, active, service_code);

CREATE TABLE diagnostic_catalogue_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  catalogue_item_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  display_name varchar(180) NOT NULL CHECK (length(trim(display_name)) > 0),
  specimen_requirements varchar(500),
  preparation_instructions varchar(1000),
  metropolis_reference_code varchar(100),
  verification_status varchar(16) NOT NULL DEFAULT 'UNVERIFIED' CHECK (verification_status IN ('SYNTHETIC', 'UNVERIFIED', 'VERIFIED', 'INACTIVE')),
  price_amount numeric(12,2) CHECK (price_amount IS NULL OR price_amount >= 0),
  currency varchar(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  price_source_reference varchar(200),
  effective_from date,
  effective_until date,
  reviewed_by_staff_id uuid,
  reviewed_at timestamptz,
  import_batch_id uuid,
  source_type varchar(20) NOT NULL CHECK (source_type IN ('MANUAL', 'CSV_IMPORT', 'SYNTHETIC_TEST')),
  created_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (catalogue_item_id, version_number),
  UNIQUE (id, organization_id, centre_id),
  FOREIGN KEY (catalogue_item_id, organization_id, centre_id) REFERENCES diagnostic_catalogue_items(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (import_batch_id, organization_id, centre_id) REFERENCES catalogue_import_batches(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (reviewed_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CHECK (effective_until IS NULL OR effective_from IS NULL OR effective_until > effective_from),
  CHECK (verification_status <> 'VERIFIED' OR (price_amount IS NOT NULL AND price_source_reference IS NOT NULL AND effective_from IS NOT NULL AND reviewed_by_staff_id IS NOT NULL AND reviewed_at IS NOT NULL)),
  CHECK (verification_status <> 'SYNTHETIC' OR source_type = 'SYNTHETIC_TEST')
);
CREATE INDEX diagnostic_catalogue_version_current_idx ON diagnostic_catalogue_versions(organization_id, centre_id, catalogue_item_id, version_number DESC);

CREATE TABLE diagnostic_package_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  package_version_id uuid NOT NULL,
  test_version_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_version_id, test_version_id),
  FOREIGN KEY (package_version_id, organization_id, centre_id) REFERENCES diagnostic_catalogue_versions(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (test_version_id, organization_id, centre_id) REFERENCES diagnostic_catalogue_versions(id, organization_id, centre_id) ON DELETE RESTRICT
);
CREATE FUNCTION validate_package_component_types() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE package_type varchar(12); test_type varchar(12);
BEGIN
  SELECT i.service_type INTO package_type FROM diagnostic_catalogue_versions v JOIN diagnostic_catalogue_items i ON i.id=v.catalogue_item_id AND i.organization_id=v.organization_id AND i.centre_id=v.centre_id WHERE v.id=NEW.package_version_id;
  SELECT i.service_type INTO test_type FROM diagnostic_catalogue_versions v JOIN diagnostic_catalogue_items i ON i.id=v.catalogue_item_id AND i.organization_id=v.organization_id AND i.centre_id=v.centre_id WHERE v.id=NEW.test_version_id;
  IF package_type <> 'PACKAGE' OR test_type <> 'TEST' THEN RAISE EXCEPTION 'package components must reference package and test catalogue versions'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER diagnostic_package_components_types BEFORE INSERT ON diagnostic_package_components FOR EACH ROW EXECUTE FUNCTION validate_package_component_types();

CREATE TABLE catalogue_price_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  catalogue_version_id uuid NOT NULL,
  decision varchar(12) NOT NULL CHECK (decision IN ('VERIFIED', 'REJECTED')),
  source_reference varchar(200) NOT NULL,
  effective_from date NOT NULL,
  effective_until date,
  reviewed_by_staff_id uuid NOT NULL,
  reason varchar(240) NOT NULL,
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (catalogue_version_id, organization_id, centre_id) REFERENCES diagnostic_catalogue_versions(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (reviewed_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

CREATE FUNCTION prevent_catalogue_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'catalogue history is append-only'; END;
$$;
CREATE FUNCTION protect_catalogue_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' OR OLD.verification_status <> 'UNVERIFIED' OR NEW.verification_status <> 'VERIFIED'
    OR NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id
    OR NEW.centre_id IS DISTINCT FROM OLD.centre_id OR NEW.catalogue_item_id IS DISTINCT FROM OLD.catalogue_item_id
    OR NEW.version_number IS DISTINCT FROM OLD.version_number OR NEW.display_name IS DISTINCT FROM OLD.display_name
    OR NEW.specimen_requirements IS DISTINCT FROM OLD.specimen_requirements OR NEW.preparation_instructions IS DISTINCT FROM OLD.preparation_instructions
    OR NEW.metropolis_reference_code IS DISTINCT FROM OLD.metropolis_reference_code OR NEW.price_amount IS DISTINCT FROM OLD.price_amount
    OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.import_batch_id IS DISTINCT FROM OLD.import_batch_id
    OR NEW.source_type IS DISTINCT FROM OLD.source_type OR NEW.created_by_staff_id IS DISTINCT FROM OLD.created_by_staff_id
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'catalogue versions are immutable; create a new version';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER diagnostic_catalogue_versions_protect BEFORE UPDATE OR DELETE ON diagnostic_catalogue_versions FOR EACH ROW EXECUTE FUNCTION protect_catalogue_version();
CREATE TRIGGER catalogue_price_reviews_append_only BEFORE UPDATE OR DELETE ON catalogue_price_reviews FOR EACH ROW EXECUTE FUNCTION prevent_catalogue_history_mutation();
CREATE TRIGGER catalogue_import_batches_append_only BEFORE UPDATE OR DELETE ON catalogue_import_batches FOR EACH ROW EXECUTE FUNCTION prevent_catalogue_history_mutation();

INSERT INTO permissions (key, description, scope) VALUES
  ('catalogue.read', 'View diagnostic tests and packages', 'CENTRE'),
  ('catalogue.manage', 'Create and version diagnostic catalogue records', 'CENTRE'),
  ('catalogue.import', 'Preview and import catalogue CSV files', 'CENTRE'),
  ('catalogue.price.verify', 'Review and approve source-backed catalogue prices', 'CENTRE')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = ANY(CASE r.key
 WHEN 'owner_super_admin' THEN ARRAY['catalogue.read','catalogue.manage','catalogue.import','catalogue.price.verify']
 WHEN 'administrator' THEN ARRAY['catalogue.read','catalogue.manage','catalogue.import','catalogue.price.verify']
 WHEN 'centre_manager' THEN ARRAY['catalogue.read','catalogue.manage','catalogue.import','catalogue.price.verify']
 WHEN 'receptionist' THEN ARRAY['catalogue.read']
 WHEN 'read_only_auditor' THEN ARRAY['catalogue.read']
 ELSE ARRAY[]::text[] END)
ON CONFLICT (role_id, permission_id) DO NOTHING;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN
    REVOKE DELETE ON TABLE catalogue_import_batches, diagnostic_catalogue_items, catalogue_price_reviews FROM rudra_dev_app;
    REVOKE DELETE ON TABLE diagnostic_catalogue_versions, diagnostic_package_components, catalogue_price_reviews FROM rudra_dev_app;
    REVOKE UPDATE, DELETE ON TABLE diagnostic_package_components, catalogue_price_reviews FROM rudra_dev_app;
  END IF;
END $$;

COMMENT ON TABLE diagnostic_catalogue_versions IS 'Versioned source-aware diagnostic catalogue data. Unverified price values must never be presented as approved customer prices.';
COMMENT ON TABLE catalogue_price_reviews IS 'Append-only staff decisions and effective-date evidence for catalogue price verification.';
