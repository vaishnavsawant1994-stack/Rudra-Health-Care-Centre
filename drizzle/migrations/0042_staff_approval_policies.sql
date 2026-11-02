-- A narrow, fail-closed policy registry. Only operational task completion is
-- supported here; sensitive domain approvals require separately authorized policy.
CREATE TABLE staff_approval_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  centre_id uuid,
  action_type varchar(40) NOT NULL CHECK (action_type = 'TASK_COMPLETION'),
  enabled boolean NOT NULL DEFAULT false,
  approver_permission varchar(40) NOT NULL DEFAULT 'tasks.approve' CHECK (approver_permission = 'tasks.approve'),
  escalation_after_minutes integer CHECK (escalation_after_minutes IS NULL OR escalation_after_minutes BETWEEN 15 AND 10080),
  escalation_owner_staff_id uuid,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  created_by_staff_id uuid NOT NULL,
  updated_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, organization_id),
  FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (escalation_owner_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT staff_approval_escalation_pair CHECK ((escalation_after_minutes IS NULL) = (escalation_owner_staff_id IS NULL))
);
CREATE UNIQUE INDEX staff_approval_policy_org_action_uq ON staff_approval_policies (organization_id, action_type) WHERE centre_id IS NULL;
CREATE UNIQUE INDEX staff_approval_policy_centre_action_uq ON staff_approval_policies (organization_id, centre_id, action_type) WHERE centre_id IS NOT NULL;

CREATE TABLE staff_approval_policy_approvers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  policy_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  created_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (policy_id, staff_id),
  FOREIGN KEY (policy_id, organization_id) REFERENCES staff_approval_policies(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX staff_approval_policy_approvers_idx ON staff_approval_policy_approvers (organization_id, staff_id, policy_id);

-- Preserve the existing operational task-completion approval workflow for
-- organizations already using the system. New organizations have no policy and
-- therefore cannot request approvals until an authorized Owner configures one.
INSERT INTO staff_approval_policies (organization_id, action_type, enabled, created_by_staff_id, updated_by_staff_id)
SELECT o.id, 'TASK_COMPLETION', true, s.id, s.id
FROM organizations o
JOIN LATERAL (SELECT id FROM staff_users WHERE organization_id = o.id AND status = 'ACTIVE' AND is_owner = true ORDER BY created_at LIMIT 1) s ON true
ON CONFLICT DO NOTHING;

ALTER TABLE staff_tasks ADD COLUMN approval_policy_id uuid;
ALTER TABLE staff_tasks ADD COLUMN escalation_owner_staff_id uuid;
ALTER TABLE staff_tasks ADD COLUMN escalation_due_at timestamptz;
ALTER TABLE staff_tasks ADD CONSTRAINT staff_tasks_approval_policy_fk FOREIGN KEY (approval_policy_id, organization_id) REFERENCES staff_approval_policies(id, organization_id) ON DELETE RESTRICT;
ALTER TABLE staff_tasks ADD CONSTRAINT staff_tasks_escalation_owner_fk FOREIGN KEY (escalation_owner_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT;
ALTER TABLE staff_tasks ADD CONSTRAINT staff_tasks_escalation_state CHECK ((escalation_owner_staff_id IS NULL) = (escalation_due_at IS NULL));
UPDATE staff_tasks t SET approval_policy_id = p.id FROM staff_approval_policies p WHERE t.organization_id = p.organization_id AND p.centre_id IS NULL AND p.action_type = 'TASK_COMPLETION' AND t.requires_approval;
CREATE INDEX staff_tasks_escalation_idx ON staff_tasks (organization_id, centre_id, escalation_due_at) WHERE status = 'AWAITING_APPROVAL' AND escalation_due_at IS NOT NULL;

ALTER TABLE staff_task_events DROP CONSTRAINT staff_task_events_event_type_check;
ALTER TABLE staff_task_events ADD CONSTRAINT staff_task_events_event_type_check CHECK (event_type IN ('CREATED','UPDATED','ASSIGNED','REASSIGNED','COMMENTED','STARTED','COMPLETED','SUBMITTED_FOR_APPROVAL','APPROVED','REJECTED','CHANGES_REQUESTED','CANCELLED','REOPENED','ESCALATION_REASSIGNED'));

INSERT INTO permissions(key, description, scope) VALUES
 ('tasks.policy.manage','Configure operational task-completion approval policy','ORGANIZATION')
ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = 'tasks.policy.manage'
WHERE r.key IN ('owner_super_admin','administrator')
ON CONFLICT(role_id, permission_id) DO NOTHING;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app') THEN
  GRANT SELECT, INSERT, UPDATE ON staff_approval_policies TO rudra_dev_app;
  GRANT SELECT, INSERT, DELETE ON staff_approval_policy_approvers TO rudra_dev_app;
  REVOKE UPDATE ON staff_approval_policy_approvers FROM rudra_dev_app;
 END IF;
END $$;
