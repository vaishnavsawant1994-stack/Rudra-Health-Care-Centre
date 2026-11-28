-- Keep the database permission registry aligned with the application catalog.
-- Audit access is organization-scoped; centre-only grants must not expose the
-- organization audit workbench or its API.
INSERT INTO permissions (key, description, scope)
VALUES ('audit.read', 'View append-only audit activity', 'ORGANIZATION')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = 'audit.read'
WHERE r.key IN ('administrator', 'owner_super_admin', 'read_only_auditor')
ON CONFLICT DO NOTHING;
