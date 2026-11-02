CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  centre_id uuid NOT NULL,
  appointment_number varchar(24) NOT NULL,
  patient_id uuid NOT NULL,
  lead_id uuid,
  booking_source varchar(24) NOT NULL CHECK (booking_source IN ('STAFF', 'CRM_LEAD', 'PHONE', 'WALK_IN', 'WEBSITE_PENDING', 'REFERRAL')),
  visit_type varchar(24) NOT NULL CHECK (visit_type IN ('CENTRE', 'HOME_COLLECTION')),
  scheduled_at timestamptz NOT NULL,
  duration_minutes smallint NOT NULL DEFAULT 30 CHECK (duration_minutes BETWEEN 10 AND 240),
  time_zone varchar(64) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'REQUESTED' CHECK (status IN ('REQUESTED', 'CONFIRMED', 'ASSIGNED', 'RESCHEDULED', 'CANCELLED', 'NO_SHOW')),
  assigned_staff_id uuid,
  home_collection_address jsonb,
  home_collection_window varchar(120),
  collection_instructions varchar(500),
  communication_permission varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (communication_permission IN ('PENDING', 'AUTHORIZED', 'WITHDRAWN')),
  communication_evidence_reference varchar(200),
  communication_permission_recorded_by uuid,
  communication_permission_recorded_at timestamptz,
  home_charge_choice varchar(16) CHECK (home_charge_choice IS NULL OR home_charge_choice IN ('ZERO', '75', '99', '150', 'CUSTOM', 'WAIVED')),
  home_charge_rupees integer CHECK (home_charge_rupees IS NULL OR home_charge_rupees BETWEEN 0 AND 100000),
  home_charge_reason varchar(240),
  created_by_staff_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointments_org_number_uq UNIQUE (organization_id, appointment_number),
  CONSTRAINT appointments_id_org_centre_uq UNIQUE (id, organization_id, centre_id),
  CONSTRAINT appointments_idempotency_uq UNIQUE (organization_id, idempotency_key),
  CONSTRAINT appointments_centre_org_fk FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT appointments_patient_scope_fk FOREIGN KEY (patient_id, organization_id, centre_id) REFERENCES patients(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT appointments_lead_scope_fk FOREIGN KEY (lead_id, organization_id, centre_id) REFERENCES leads(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT appointments_assignee_org_fk FOREIGN KEY (assigned_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT appointments_creator_org_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT appointments_communication_recorder_fk FOREIGN KEY (communication_permission_recorded_by, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT appointments_home_fields CHECK (
    (visit_type = 'CENTRE' AND home_collection_address IS NULL AND home_collection_window IS NULL AND home_charge_choice IS NULL AND home_charge_rupees IS NULL)
    OR (visit_type = 'HOME_COLLECTION' AND home_collection_address IS NOT NULL AND home_collection_window IS NOT NULL AND home_charge_choice IS NOT NULL AND home_charge_rupees IS NOT NULL)
  ),
  CONSTRAINT appointments_home_charge_choice_amount CHECK (
    home_charge_choice IS NULL
    OR (home_charge_choice = 'ZERO' AND home_charge_rupees = 0)
    OR (home_charge_choice = '75' AND home_charge_rupees = 75)
    OR (home_charge_choice = '99' AND home_charge_rupees = 99)
    OR (home_charge_choice = '150' AND home_charge_rupees = 150)
    OR (home_charge_choice = 'CUSTOM' AND home_charge_reason IS NOT NULL AND length(trim(home_charge_reason)) >= 3)
    OR (home_charge_choice = 'WAIVED' AND home_charge_rupees = 0 AND home_charge_reason IS NOT NULL AND length(trim(home_charge_reason)) >= 3)
  ),
  CONSTRAINT appointments_communication_evidence CHECK (communication_permission <> 'AUTHORIZED' OR (communication_evidence_reference IS NOT NULL AND communication_permission_recorded_by IS NOT NULL AND communication_permission_recorded_at IS NOT NULL))
);
CREATE INDEX appointments_centre_time_idx ON appointments(organization_id, centre_id, scheduled_at);
CREATE INDEX appointments_centre_status_time_idx ON appointments(organization_id, centre_id, status, scheduled_at);
CREATE INDEX appointments_assignee_time_idx ON appointments(organization_id, assigned_staff_id, status, scheduled_at);
CREATE INDEX appointments_patient_time_idx ON appointments(organization_id, patient_id, scheduled_at DESC);
CREATE INDEX appointments_lead_idx ON appointments(organization_id, lead_id) WHERE lead_id IS NOT NULL;

CREATE TABLE appointment_services (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  service_type varchar(12) NOT NULL CHECK (service_type IN ('TEST', 'PACKAGE', 'OTHER')),
  service_name varchar(160) NOT NULL CHECK (length(trim(service_name)) > 0),
  service_reference varchar(100),
  verification_status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (verification_status IN ('PENDING', 'VERIFIED', 'UNAVAILABLE')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_services_appointment_scope_fk FOREIGN KEY (appointment_id, organization_id, centre_id) REFERENCES appointments(id, organization_id, centre_id) ON DELETE RESTRICT
);
CREATE INDEX appointment_services_appt_idx ON appointment_services(organization_id, appointment_id);

CREATE TABLE appointment_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  from_status varchar(20),
  to_status varchar(20) NOT NULL CHECK (to_status IN ('REQUESTED', 'CONFIRMED', 'ASSIGNED', 'RESCHEDULED', 'CANCELLED', 'NO_SHOW')),
  reason varchar(240) NOT NULL,
  previous_scheduled_at timestamptz,
  new_scheduled_at timestamptz NOT NULL,
  actor_staff_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_status_history_scope_fk FOREIGN KEY (appointment_id, organization_id, centre_id) REFERENCES appointments(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT appointment_status_history_actor_fk FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX appointment_status_history_appt_idx ON appointment_status_history(organization_id, appointment_id, recorded_at DESC);

CREATE TABLE appointment_assignment_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  action varchar(16) NOT NULL CHECK (action IN ('ASSIGNED', 'REASSIGNED', 'UNASSIGNED')),
  staff_id uuid,
  previous_staff_id uuid,
  work_start timestamptz NOT NULL,
  work_end timestamptz NOT NULL,
  reason varchar(240) NOT NULL,
  actor_staff_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT appointment_assignment_time CHECK (work_end > work_start),
  CONSTRAINT appointment_assignment_scope_fk FOREIGN KEY (appointment_id, organization_id, centre_id) REFERENCES appointments(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT appointment_assignment_staff_fk FOREIGN KEY (staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT appointment_assignment_previous_staff_fk FOREIGN KEY (previous_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT appointment_assignment_actor_fk FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX appointment_assignment_history_staff_idx ON appointment_assignment_history(organization_id, staff_id, work_start DESC);

CREATE FUNCTION prevent_appointment_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'appointment history is append-only';
END;
$$;
CREATE TRIGGER appointment_status_history_append_only BEFORE UPDATE OR DELETE ON appointment_status_history FOR EACH ROW EXECUTE FUNCTION prevent_appointment_history_mutation();
CREATE TRIGGER appointment_assignment_history_append_only BEFORE UPDATE OR DELETE ON appointment_assignment_history FOR EACH ROW EXECUTE FUNCTION prevent_appointment_history_mutation();

INSERT INTO permissions (key, description, scope) VALUES
  ('appointments.read', 'View appointments within authorized centres', 'CENTRE'),
  ('appointments.assigned.read', 'View only appointments assigned to the signed-in staff member', 'CENTRE'),
  ('appointments.create', 'Create patient appointments within authorized centres', 'CENTRE'),
  ('appointments.update', 'Edit appointment booking details and status', 'CENTRE'),
  ('appointments.assign', 'Assign or reassign appointment staff', 'CENTRE'),
  ('appointments.cancel', 'Cancel appointments with a recorded reason', 'CENTRE'),
  ('appointments.home_charge.manage', 'Approve custom or waived home-collection charges', 'CENTRE')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r JOIN permissions p ON p.key = ANY(CASE r.key
  WHEN 'owner_super_admin' THEN ARRAY['appointments.read','appointments.create','appointments.update','appointments.assign','appointments.cancel','appointments.home_charge.manage']
  WHEN 'administrator' THEN ARRAY['appointments.read','appointments.create','appointments.update','appointments.assign','appointments.cancel','appointments.home_charge.manage']
  WHEN 'centre_manager' THEN ARRAY['appointments.read','appointments.create','appointments.update','appointments.assign','appointments.cancel','appointments.home_charge.manage']
  WHEN 'receptionist' THEN ARRAY['appointments.read','appointments.create','appointments.update','appointments.cancel']
  WHEN 'phlebotomist' THEN ARRAY['appointments.assigned.read']
  ELSE ARRAY[]::text[]
END)
ON CONFLICT (role_id, permission_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN
    REVOKE DELETE ON TABLE appointments, appointment_services FROM rudra_dev_app;
    REVOKE UPDATE, DELETE ON TABLE appointment_status_history, appointment_assignment_history FROM rudra_dev_app;
  END IF;
END $$;

COMMENT ON TABLE appointments IS 'Appointment booking only. Does not imply sample collection, lab processing, report delivery or billing.';
COMMENT ON TABLE appointment_services IS 'Free-text service references remain pending verification until an approved catalogue is integrated.';
COMMENT ON TABLE appointment_status_history IS 'Append-only appointment transitions and rescheduling history.';
COMMENT ON TABLE appointment_assignment_history IS 'Append-only staff assignment and reassignment evidence.';
