-- Permission catalog and least-privilege role templates used by the R1.1 API.
BEGIN;

INSERT INTO permissions (code, module, action, description) VALUES
  ('patients.read','patients','read','Read patient records in the assigned centre scope'),
  ('patients.contact.read','patients','contact_read','Read unmasked patient contact details'),
  ('patients.address.read','patients','address_read','Read patient address details'),
  ('patients.duplicate.override','patients','duplicate_override','Approve creating or updating a patient despite a possible duplicate'),
  ('patients.create','patients','create','Register patients in the assigned centre scope'),
  ('patients.update','patients','update','Update patient records and family links in scope'),
  ('leads.read','leads','read','Read leads in the assigned centre scope'),
  ('leads.create','leads','create','Create leads in the assigned centre scope'),
  ('leads.update','leads','update','Update leads and record activities in scope'),
  ('leads.convert','leads','convert','Convert leads into Rudra patient records'),
  ('audit.read','audit','read','Read audit history')
ON CONFLICT (code) DO NOTHING;

CREATE FUNCTION seed_organization_roles(target_organization uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE role_row record;
BEGIN
  FOR role_row IN
    SELECT * FROM (VALUES
      ('OWNER','Owner'), ('SUPER_ADMIN','Super Admin'), ('ADMIN','Administrator'),
      ('CENTRE_MANAGER','Centre Manager'), ('RECEPTIONIST','Receptionist'),
      ('PHLEBOTOMIST','Phlebotomist'), ('CUSTOMER_SUPPORT','Customer Support'),
      ('ACCOUNTS','Accounts'), ('SALES_RELATIONSHIP','Sales / Relationship Manager'),
      ('READ_ONLY_AUDITOR','Read-only Auditor')
    ) AS seeded(code, name)
  LOOP
    INSERT INTO roles (organization_id, code, name, description, is_system_role)
      VALUES (target_organization, role_row.code, role_row.name, 'Rudra R1 system role', true)
      ON CONFLICT (organization_id, code) DO NOTHING;
  END LOOP;
END;
$$;

CREATE FUNCTION apply_default_role_permissions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO role_permissions (organization_id, role_id, permission_id, allow)
  SELECT NEW.organization_id, NEW.id, p.id, true
  FROM permissions p
  WHERE
    NEW.code IN ('OWNER','SUPER_ADMIN')
    OR (NEW.code = 'ADMIN' AND p.code <> 'audit.read')
    OR (NEW.code = 'CENTRE_MANAGER' AND p.code IN ('patients.read','patients.contact.read','patients.address.read','patients.duplicate.override','patients.create','patients.update','leads.read','leads.create','leads.update','leads.convert','audit.read'))
    OR (NEW.code = 'RECEPTIONIST' AND p.code IN ('patients.read','patients.contact.read','patients.address.read','patients.create','patients.update','leads.read','leads.create','leads.update','leads.convert'))
    OR (NEW.code = 'CUSTOMER_SUPPORT' AND p.code IN ('patients.read','patients.contact.read','patients.address.read','leads.read','leads.update'))
    OR (NEW.code = 'SALES_RELATIONSHIP' AND p.code IN ('patients.create','leads.read','leads.create','leads.update','leads.convert'))
    OR (NEW.code = 'READ_ONLY_AUDITOR' AND p.code IN ('patients.read','leads.read','audit.read'))
  ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER roles_default_permissions AFTER INSERT ON roles
  FOR EACH ROW EXECUTE FUNCTION apply_default_role_permissions();

CREATE FUNCTION seed_roles_for_new_organization() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM seed_organization_roles(NEW.id);
  RETURN NEW;
END;
$$;
CREATE TRIGGER organizations_seed_roles AFTER INSERT ON organizations
  FOR EACH ROW EXECUTE FUNCTION seed_roles_for_new_organization();

SELECT seed_organization_roles(id) FROM organizations;

-- Backfill policy grants for any matching system roles that existed before this migration.
INSERT INTO role_permissions (organization_id, role_id, permission_id, allow)
SELECT r.organization_id, r.id, p.id, true
FROM roles r CROSS JOIN permissions p
WHERE r.is_system_role AND (
  r.code IN ('OWNER','SUPER_ADMIN')
  OR (r.code = 'ADMIN' AND p.code <> 'audit.read')
  OR (r.code = 'CENTRE_MANAGER' AND p.code IN ('patients.read','patients.contact.read','patients.address.read','patients.duplicate.override','patients.create','patients.update','leads.read','leads.create','leads.update','leads.convert','audit.read'))
  OR (r.code = 'RECEPTIONIST' AND p.code IN ('patients.read','patients.contact.read','patients.address.read','patients.create','patients.update','leads.read','leads.create','leads.update','leads.convert'))
  OR (r.code = 'CUSTOMER_SUPPORT' AND p.code IN ('patients.read','patients.contact.read','patients.address.read','leads.read','leads.update'))
  OR (r.code = 'SALES_RELATIONSHIP' AND p.code IN ('patients.create','leads.read','leads.create','leads.update','leads.convert'))
  OR (r.code = 'READ_ONLY_AUDITOR' AND p.code IN ('patients.read','leads.read','audit.read'))
)
ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;

COMMIT;
