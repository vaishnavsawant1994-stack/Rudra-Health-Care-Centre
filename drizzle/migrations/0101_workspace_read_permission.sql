-- The permission catalog and task APIs require workspace.read, but older
-- migration history did not create its database permission row. Add the
-- centre-scoped permission and synchronize only catalogued system roles.
INSERT INTO permissions (key, description, scope)
VALUES ('workspace.read', 'Open the staff workspace', 'CENTRE')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = 'workspace.read'
WHERE r.key IN (
  'accounts',
  'administrator',
  'centre_manager',
  'customer_support',
  'laboratory_branch_operations',
  'owner_super_admin',
  'phlebotomist',
  'read_only_auditor',
  'receptionist',
  'sales_marketing'
)
ON CONFLICT DO NOTHING;
