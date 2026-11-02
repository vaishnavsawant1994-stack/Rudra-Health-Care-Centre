DELETE FROM role_permissions rp
USING roles r, permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.key = 'customer_support'
  AND p.key IN ('patients.read', 'patients.create', 'patients.update');
