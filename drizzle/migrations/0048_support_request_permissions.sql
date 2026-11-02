INSERT INTO permissions(key, description, scope) VALUES
 ('tasks.support.read','View centre-scoped support request tasks','CENTRE'),
 ('tasks.support.create','Create support request tasks','CENTRE'),
 ('tasks.support.manage','Manage and reassign centre support request tasks','CENTRE')
ON CONFLICT(key) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = ANY(CASE r.key
 WHEN 'owner_super_admin' THEN ARRAY['tasks.support.read','tasks.support.create','tasks.support.manage']
 WHEN 'administrator' THEN ARRAY['tasks.support.read','tasks.support.create','tasks.support.manage']
 WHEN 'centre_manager' THEN ARRAY['tasks.support.read','tasks.support.create','tasks.support.manage']
 WHEN 'receptionist' THEN ARRAY['tasks.support.create']
 WHEN 'customer_support' THEN ARRAY['tasks.support.read','tasks.support.create','tasks.support.manage']
 ELSE ARRAY[]::text[] END)
ON CONFLICT(role_id, permission_id) DO NOTHING;
