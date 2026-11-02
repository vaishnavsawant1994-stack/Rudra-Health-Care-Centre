INSERT INTO permissions (key, description, scope) VALUES
  ('families.read', 'View family records within authorized centre scope', 'CENTRE'),
  ('families.create', 'Create family records within authorized centre scope', 'CENTRE'),
  ('families.update', 'Update family records within authorized centre scope', 'CENTRE'),
  ('families.members.manage', 'Add, edit, and end family member associations', 'CENTRE'),
  ('families.members.verify', 'Record offline verification of a family association', 'CENTRE'),
  ('families.sharing.manage', 'Request and revoke named family sharing grants', 'CENTRE'),
  ('families.sharing.verify', 'Record verification of explicit family sharing authorization', 'CENTRE');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = ANY(CASE r.key
  WHEN 'owner_super_admin' THEN ARRAY['families.read', 'families.create', 'families.update', 'families.members.manage', 'families.members.verify', 'families.sharing.manage', 'families.sharing.verify']
  WHEN 'administrator' THEN ARRAY['families.read', 'families.create', 'families.update', 'families.members.manage', 'families.members.verify', 'families.sharing.manage', 'families.sharing.verify']
  WHEN 'centre_manager' THEN ARRAY['families.read', 'families.create', 'families.update', 'families.members.manage', 'families.members.verify', 'families.sharing.manage', 'families.sharing.verify']
  WHEN 'receptionist' THEN ARRAY['families.read', 'families.create', 'families.update', 'families.members.manage', 'families.sharing.manage']
  ELSE ARRAY[]::text[]
END)
ON CONFLICT (role_id, permission_id) DO NOTHING;
