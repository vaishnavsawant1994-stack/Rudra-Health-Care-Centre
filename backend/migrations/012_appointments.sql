-- Centre-scoped appointment scheduling. Metropolis operations remain manual and external.
BEGIN;

CREATE TABLE appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  public_id text NOT NULL,
  centre_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  service_type text NOT NULL CHECK (service_type IN ('CENTRE_VISIT','HOME_COLLECTION')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  collection_address_ciphertext bytea,
  status text NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED','CONFIRMED','CHECKED_IN','IN_SERVICE','COMPLETED','CANCELLED','NO_SHOW')),
  assigned_staff_id uuid,
  cancellation_code text CHECK (cancellation_code IS NULL OR cancellation_code IN ('PATIENT_REQUEST','STAFF_UNAVAILABLE','DUPLICATE','SERVICE_UNAVAILABLE','OTHER')),
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, id, centre_id),
  UNIQUE (organization_id, public_id),
  FOREIGN KEY (organization_id, centre_id) REFERENCES centres(organization_id, id),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patients(organization_id, id),
  FOREIGN KEY (organization_id, assigned_staff_id) REFERENCES users(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id),
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id),
  CHECK (ends_at > starts_at),
  CHECK (ends_at - starts_at <= interval '12 hours'),
  CHECK ((service_type='HOME_COLLECTION') = (collection_address_ciphertext IS NOT NULL)),
  CHECK ((status = 'CANCELLED') = (cancellation_code IS NOT NULL))
);
CREATE INDEX appointments_schedule ON appointments (organization_id, centre_id, starts_at, status);
CREATE INDEX appointments_patient_schedule ON appointments (organization_id, patient_id, starts_at DESC);

CREATE TABLE appointment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  appointment_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('SCHEDULED','RESCHEDULED','UPDATED','STATUS_CHANGED')),
  previous_status text,
  new_status text NOT NULL,
  reason_code text,
  actor_user_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'INTERNAL',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,appointment_id) REFERENCES appointments(organization_id,id),
  FOREIGN KEY (organization_id,actor_user_id) REFERENCES users(organization_id,id)
);
CREATE INDEX appointment_events_history ON appointment_events (organization_id,appointment_id,occurred_at DESC);
CREATE TRIGGER appointment_events_append_only BEFORE UPDATE OR DELETE ON appointment_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

INSERT INTO permissions (code,module,action,description) VALUES
 ('appointments.read','appointments','read','Read appointments in assigned centres'),
 ('appointments.create','appointments','create','Schedule appointments in assigned centres'),
 ('appointments.update','appointments','update','Reschedule appointments in assigned centres'),
 ('appointments.status','appointments','status','Confirm, check in, complete, cancel, or record no-shows'),
 ('service_orders.read','service_orders','read','Read service orders in assigned centres'),
 ('service_orders.create','service_orders','create','Create service orders in assigned centres'),
 ('service_orders.update','service_orders','update','Update eligible service orders in assigned centres'),
 ('service_orders.status','service_orders','status','Advance service order processing status')
ON CONFLICT (code) DO NOTHING;

CREATE OR REPLACE FUNCTION apply_r13_role_permissions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO role_permissions (organization_id,role_id,permission_id,allow)
  SELECT NEW.organization_id,NEW.id,p.id,true
  FROM permissions p
  WHERE NEW.code IN ('OWNER','SUPER_ADMIN')
    OR (NEW.code='ADMIN' AND p.code<>'audit.read')
    OR (NEW.code='CENTRE_MANAGER' AND p.code IN (
      'appointments.read','appointments.create','appointments.update','appointments.status',
      'service_orders.read','service_orders.create','service_orders.update','service_orders.status'))
    OR (NEW.code='RECEPTIONIST' AND p.code IN (
      'appointments.read','appointments.create','appointments.update','appointments.status',
      'service_orders.read','service_orders.create','service_orders.update'))
    OR (NEW.code='PHLEBOTOMIST' AND p.code IN ('appointments.read','service_orders.read','service_orders.status','patients.address.read'))
    OR (NEW.code='CUSTOMER_SUPPORT' AND p.code IN ('appointments.read','service_orders.read'))
    OR (NEW.code='ACCOUNTS' AND p.code='service_orders.read')
    OR (NEW.code='READ_ONLY_AUDITOR' AND p.code IN ('appointments.read','service_orders.read'))
  ON CONFLICT (organization_id,role_id,permission_id) DO NOTHING;
  RETURN NEW;
END;
$$;
CREATE TRIGGER roles_r13_permissions AFTER INSERT ON roles
  FOR EACH ROW EXECUTE FUNCTION apply_r13_role_permissions();

INSERT INTO role_permissions (organization_id,role_id,permission_id,allow)
SELECT r.organization_id,r.id,p.id,true
FROM roles r CROSS JOIN permissions p
WHERE r.is_system_role AND (
  r.code IN ('OWNER','SUPER_ADMIN')
  OR (r.code='ADMIN' AND p.code<>'audit.read')
  OR (r.code='CENTRE_MANAGER' AND p.code IN (
    'appointments.read','appointments.create','appointments.update','appointments.status',
    'service_orders.read','service_orders.create','service_orders.update','service_orders.status'))
  OR (r.code='RECEPTIONIST' AND p.code IN (
    'appointments.read','appointments.create','appointments.update','appointments.status',
    'service_orders.read','service_orders.create','service_orders.update'))
  OR (r.code='PHLEBOTOMIST' AND p.code IN ('appointments.read','service_orders.read','service_orders.status','patients.address.read'))
  OR (r.code='CUSTOMER_SUPPORT' AND p.code IN ('appointments.read','service_orders.read'))
  OR (r.code='ACCOUNTS' AND p.code='service_orders.read')
  OR (r.code='READ_ONLY_AUDITOR' AND p.code IN ('appointments.read','service_orders.read'))
)
ON CONFLICT (organization_id,role_id,permission_id) DO NOTHING;

COMMIT;
