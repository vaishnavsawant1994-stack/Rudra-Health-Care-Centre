-- Centre-scoped diagnostic catalogue. Prices are integer minor currency units.
BEGIN;

CREATE TABLE catalogue_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  public_id text NOT NULL,
  centre_id uuid NOT NULL,
  code text NOT NULL CHECK (length(trim(code)) BETWEEN 1 AND 40),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 180),
  category text CHECK (category IS NULL OR length(trim(category)) <= 120),
  specimen_type text CHECK (specimen_type IS NULL OR length(trim(specimen_type)) <= 120),
  fasting_required boolean NOT NULL DEFAULT false,
  preparation_instructions text CHECK (preparation_instructions IS NULL OR length(preparation_instructions) <= 4000),
  turnaround_hours integer CHECK (turnaround_hours IS NULL OR turnaround_hours BETWEEN 0 AND 8760),
  price_minor bigint CHECK (price_minor IS NULL OR price_minor >= 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, id, centre_id),
  UNIQUE (organization_id, public_id),
  UNIQUE (organization_id, centre_id, code),
  FOREIGN KEY (organization_id, centre_id) REFERENCES centres(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id),
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id)
);
CREATE INDEX catalogue_tests_search ON catalogue_tests (organization_id, centre_id, status, lower(name));

CREATE TABLE catalogue_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  public_id text NOT NULL,
  centre_id uuid NOT NULL,
  code text NOT NULL CHECK (length(trim(code)) BETWEEN 1 AND 40),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 180),
  category text CHECK (category IS NULL OR length(trim(category)) <= 120),
  description text CHECK (description IS NULL OR length(description) <= 4000),
  price_minor bigint CHECK (price_minor IS NULL OR price_minor >= 0),
  currency text NOT NULL DEFAULT 'INR' CHECK (currency ~ '^[A-Z]{3}$'),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, id, centre_id),
  UNIQUE (organization_id, public_id),
  UNIQUE (organization_id, centre_id, code),
  FOREIGN KEY (organization_id, centre_id) REFERENCES centres(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id),
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id)
);
CREATE INDEX catalogue_packages_search ON catalogue_packages (organization_id, centre_id, status, lower(name));

CREATE TABLE catalogue_package_items (
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  package_id uuid NOT NULL,
  test_id uuid NOT NULL,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 100),
  display_order integer NOT NULL DEFAULT 0 CHECK (display_order >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, package_id, test_id),
  FOREIGN KEY (organization_id, package_id, centre_id) REFERENCES catalogue_packages(organization_id, id, centre_id),
  FOREIGN KEY (organization_id, test_id, centre_id) REFERENCES catalogue_tests(organization_id, id, centre_id)
);
CREATE INDEX catalogue_package_items_order ON catalogue_package_items (organization_id, package_id, display_order);

INSERT INTO permissions (code, module, action, description) VALUES
 ('doctors.read','doctors','read','Read doctor directory records in assigned centres'),
 ('doctors.create','doctors','create','Create doctor directory records'),
 ('doctors.update','doctors','update','Update doctor directory records'),
 ('doctors.contact.read','doctors','contact_read','Read doctor contact details'),
 ('doctors.credentials.read','doctors','credentials_read','Read doctor registration credentials'),
 ('corporates.read','corporates','read','Read corporate accounts in assigned centres'),
 ('corporates.create','corporates','create','Create corporate accounts'),
 ('corporates.update','corporates','update','Update corporate accounts'),
 ('corporates.contact.read','corporates','contact_read','Read corporate contact details'),
 ('partners.read','partners','read','Read partner directory records in assigned centres'),
 ('partners.create','partners','create','Create partner directory records'),
 ('partners.update','partners','update','Update partner directory records'),
 ('partners.contact.read','partners','contact_read','Read partner contact details'),
 ('catalogue.tests.read','catalogue','tests_read','Read diagnostic test catalogue in assigned centres'),
 ('catalogue.tests.create','catalogue','tests_create','Create diagnostic test catalogue entries'),
 ('catalogue.tests.update','catalogue','tests_update','Update diagnostic test catalogue entries'),
 ('catalogue.packages.read','catalogue','packages_read','Read test packages in assigned centres'),
 ('catalogue.packages.create','catalogue','packages_create','Create test packages'),
 ('catalogue.packages.update','catalogue','packages_update','Update test packages')
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION apply_r12_role_permissions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO role_permissions (organization_id, role_id, permission_id, allow)
  SELECT NEW.organization_id, NEW.id, p.id, true
  FROM permissions p
  WHERE NEW.code IN ('OWNER','SUPER_ADMIN')
     OR (NEW.code = 'ADMIN' AND p.code <> 'audit.read')
     OR (NEW.code = 'CENTRE_MANAGER' AND p.code IN (
       'doctors.read','doctors.create','doctors.update','doctors.contact.read',
       'corporates.read','corporates.create','corporates.update','corporates.contact.read',
       'partners.read','partners.create','partners.update','partners.contact.read',
       'catalogue.tests.read','catalogue.tests.create','catalogue.tests.update',
       'catalogue.packages.read','catalogue.packages.create','catalogue.packages.update'))
     OR (NEW.code = 'RECEPTIONIST' AND p.code IN (
       'doctors.read','doctors.contact.read','corporates.read','corporates.contact.read',
       'partners.read','partners.contact.read','catalogue.tests.read','catalogue.packages.read'))
     OR (NEW.code = 'CUSTOMER_SUPPORT' AND p.code IN (
       'doctors.read','doctors.contact.read','partners.read','partners.contact.read',
       'catalogue.tests.read','catalogue.packages.read'))
     OR (NEW.code = 'ACCOUNTS' AND p.code IN (
       'corporates.read','corporates.contact.read','catalogue.tests.read','catalogue.packages.read'))
     OR (NEW.code = 'SALES_RELATIONSHIP' AND p.code IN (
       'doctors.read','doctors.contact.read','corporates.read','corporates.create','corporates.update','corporates.contact.read',
       'partners.read','partners.create','partners.update','partners.contact.read',
       'catalogue.tests.read','catalogue.packages.read'))
     OR (NEW.code = 'PHLEBOTOMIST' AND p.code IN ('catalogue.tests.read','catalogue.packages.read'))
     OR (NEW.code = 'READ_ONLY_AUDITOR' AND p.code IN (
       'doctors.read','corporates.read','partners.read','catalogue.tests.read','catalogue.packages.read'))
  ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER roles_r12_permissions AFTER INSERT ON roles
  FOR EACH ROW EXECUTE FUNCTION apply_r12_role_permissions();

INSERT INTO role_permissions (organization_id, role_id, permission_id, allow)
SELECT r.organization_id, r.id, p.id, true
FROM roles r CROSS JOIN permissions p
WHERE r.is_system_role AND (
  r.code IN ('OWNER','SUPER_ADMIN')
  OR (r.code = 'ADMIN' AND p.code <> 'audit.read')
  OR (r.code = 'CENTRE_MANAGER' AND p.code IN (
    'doctors.read','doctors.create','doctors.update','doctors.contact.read',
    'corporates.read','corporates.create','corporates.update','corporates.contact.read',
    'partners.read','partners.create','partners.update','partners.contact.read',
    'catalogue.tests.read','catalogue.tests.create','catalogue.tests.update',
    'catalogue.packages.read','catalogue.packages.create','catalogue.packages.update'))
  OR (r.code = 'RECEPTIONIST' AND p.code IN (
    'doctors.read','doctors.contact.read','corporates.read','corporates.contact.read',
    'partners.read','partners.contact.read','catalogue.tests.read','catalogue.packages.read'))
  OR (r.code = 'CUSTOMER_SUPPORT' AND p.code IN (
    'doctors.read','doctors.contact.read','partners.read','partners.contact.read',
    'catalogue.tests.read','catalogue.packages.read'))
  OR (r.code = 'ACCOUNTS' AND p.code IN (
    'corporates.read','corporates.contact.read','catalogue.tests.read','catalogue.packages.read'))
  OR (r.code = 'SALES_RELATIONSHIP' AND p.code IN (
    'doctors.read','doctors.contact.read','corporates.read','corporates.create','corporates.update','corporates.contact.read',
    'partners.read','partners.create','partners.update','partners.contact.read',
    'catalogue.tests.read','catalogue.packages.read'))
  OR (r.code = 'PHLEBOTOMIST' AND p.code IN ('catalogue.tests.read','catalogue.packages.read'))
  OR (r.code = 'READ_ONLY_AUDITOR' AND p.code IN (
    'doctors.read','corporates.read','partners.read','catalogue.tests.read','catalogue.packages.read'))
)
ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;

COMMIT;
