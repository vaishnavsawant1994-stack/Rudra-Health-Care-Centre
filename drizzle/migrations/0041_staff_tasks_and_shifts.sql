CREATE TABLE staff_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  centre_id uuid NOT NULL,
  task_number varchar(32) NOT NULL,
  private_data_ciphertext text NOT NULL,
  task_type varchar(24) NOT NULL CHECK (task_type IN ('GENERAL','OPERATIONS','FOLLOW_UP','EXCEPTION_REVIEW')),
  priority varchar(12) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  status varchar(24) NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_PROGRESS','AWAITING_APPROVAL','COMPLETED','CANCELLED')),
  requires_approval boolean NOT NULL DEFAULT false,
  approval_status varchar(24) NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (approval_status IN ('NOT_REQUIRED','PENDING','APPROVED','REJECTED','CHANGES_REQUESTED')),
  assigned_staff_id uuid NOT NULL,
  created_by_staff_id uuid NOT NULL,
  approved_by_staff_id uuid,
  approved_at timestamptz,
  due_at timestamptz,
  idempotency_key uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_tasks_centre_fk FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT staff_tasks_assignee_fk FOREIGN KEY (assigned_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT staff_tasks_creator_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT staff_tasks_approver_fk FOREIGN KEY (approved_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT staff_tasks_approval_state CHECK ((approval_status = 'APPROVED' AND approved_by_staff_id IS NOT NULL AND approved_at IS NOT NULL AND status = 'COMPLETED') OR (approval_status <> 'APPROVED' AND approved_by_staff_id IS NULL AND approved_at IS NULL)),
  CONSTRAINT staff_tasks_pending_approval_state CHECK ((status = 'AWAITING_APPROVAL' AND requires_approval AND approval_status = 'PENDING') OR (status <> 'AWAITING_APPROVAL' AND approval_status <> 'PENDING')),
  CONSTRAINT staff_tasks_no_self_approval CHECK (approved_by_staff_id IS NULL OR approved_by_staff_id <> created_by_staff_id),
  UNIQUE (organization_id, task_number),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (id, organization_id, centre_id)
);
CREATE INDEX staff_tasks_queue_idx ON staff_tasks (organization_id, centre_id, status, priority, due_at);
CREATE INDEX staff_tasks_assignee_idx ON staff_tasks (organization_id, assigned_staff_id, status, due_at);

CREATE TABLE staff_task_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  task_id uuid NOT NULL,
  event_type varchar(24) NOT NULL CHECK (event_type IN ('CREATED','UPDATED','ASSIGNED','REASSIGNED','COMMENTED','STARTED','COMPLETED','SUBMITTED_FOR_APPROVAL','APPROVED','REJECTED','CHANGES_REQUESTED','CANCELLED','REOPENED')),
  private_data_ciphertext text NOT NULL,
  actor_staff_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (task_id, organization_id, centre_id) REFERENCES staff_tasks(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX staff_task_events_task_idx ON staff_task_events (organization_id, task_id, recorded_at);
CREATE FUNCTION prevent_staff_task_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'staff task history is append-only'; END $$;
CREATE TRIGGER staff_task_events_append_only BEFORE UPDATE OR DELETE ON staff_task_events FOR EACH ROW EXECUTE FUNCTION prevent_staff_task_event_mutation();

CREATE TABLE staff_shifts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  centre_id uuid NOT NULL,
  staff_id uuid NOT NULL,
  shift_type varchar(20) NOT NULL CHECK (shift_type IN ('SCHEDULED','UNAVAILABLE')),
  status varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','CANCELLED')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  time_zone varchar(64) NOT NULL,
  private_data_ciphertext text NOT NULL,
  created_by_staff_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_shifts_time_check CHECK (ends_at > starts_at),
  FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (id, organization_id, centre_id)
);
CREATE INDEX staff_shifts_schedule_idx ON staff_shifts (organization_id, centre_id, starts_at, ends_at, status);
CREATE INDEX staff_shifts_person_idx ON staff_shifts (organization_id, staff_id, starts_at, status);
CREATE TABLE staff_shift_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  shift_id uuid NOT NULL,
  event_type varchar(20) NOT NULL CHECK (event_type IN ('CREATED','UPDATED','CANCELLED')),
  private_data_ciphertext text NOT NULL,
  actor_staff_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (shift_id, organization_id, centre_id) REFERENCES staff_shifts(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX staff_shift_events_shift_idx ON staff_shift_events (organization_id, shift_id, recorded_at);
CREATE FUNCTION prevent_staff_shift_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'staff shift history is append-only'; END $$;
CREATE TRIGGER staff_shift_events_append_only BEFORE UPDATE OR DELETE ON staff_shift_events FOR EACH ROW EXECUTE FUNCTION prevent_staff_shift_event_mutation();

INSERT INTO permissions(key, description, scope) VALUES
 ('tasks.read','View centre tasks within assigned scope','CENTRE'),
 ('tasks.assigned.read','View only tasks assigned to the signed-in staff member','CENTRE'),
 ('tasks.create','Create centre operational tasks','CENTRE'),
 ('tasks.update','Update assigned tasks or manage centre task status','CENTRE'),
 ('tasks.assign','Assign and reassign centre tasks','CENTRE'),
 ('tasks.approve','Review operational task completion requests','CENTRE'),
 ('roster.read','View staff shifts and availability in authorized centres','CENTRE'),
 ('roster.manage','Create, edit and cancel staff shifts and unavailability','CENTRE')
ON CONFLICT(key) DO NOTHING;
INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = ANY(CASE r.key
 WHEN 'owner_super_admin' THEN ARRAY['tasks.read','tasks.assigned.read','tasks.create','tasks.update','tasks.assign','tasks.approve','roster.read','roster.manage']
 WHEN 'administrator' THEN ARRAY['tasks.read','tasks.assigned.read','tasks.create','tasks.update','tasks.assign','tasks.approve','roster.read','roster.manage']
 WHEN 'centre_manager' THEN ARRAY['tasks.read','tasks.assigned.read','tasks.create','tasks.update','tasks.assign','tasks.approve','roster.read','roster.manage']
 WHEN 'receptionist' THEN ARRAY['tasks.assigned.read','tasks.create','tasks.update']
 WHEN 'phlebotomist' THEN ARRAY['tasks.assigned.read','tasks.update','roster.read']
 WHEN 'laboratory_branch_operations' THEN ARRAY['tasks.assigned.read','tasks.update','roster.read']
 WHEN 'accounts' THEN ARRAY['tasks.assigned.read','tasks.update']
 WHEN 'customer_support' THEN ARRAY['tasks.assigned.read','tasks.create','tasks.update']
 WHEN 'sales_marketing' THEN ARRAY['tasks.assigned.read','tasks.create','tasks.update']
 WHEN 'read_only_auditor' THEN ARRAY['tasks.read','roster.read']
 ELSE ARRAY[]::text[] END)
ON CONFLICT(role_id, permission_id) DO NOTHING;
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app') THEN
  GRANT SELECT, INSERT, UPDATE ON staff_tasks, staff_shifts TO rudra_dev_app;
  GRANT SELECT, INSERT ON staff_task_events, staff_shift_events TO rudra_dev_app;
  REVOKE UPDATE, DELETE ON staff_task_events, staff_shift_events FROM rudra_dev_app;
  REVOKE DELETE ON staff_tasks, staff_shifts FROM rudra_dev_app;
 END IF;
END $$;
