-- Rudra-owned order lifecycle and price snapshots. No Metropolis synchronization or reports.
BEGIN;

CREATE TABLE service_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  public_id text NOT NULL,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  request_hash bytea NOT NULL CHECK (length(request_hash)=32),
  centre_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  appointment_id uuid,
  status text NOT NULL DEFAULT 'BOOKED' CHECK (status IN ('BOOKED','SAMPLE_COLLECTED','IN_PROCESS','PARTIAL','COMPLETED','CANCELLED')),
  cancellation_code text CHECK (cancellation_code IS NULL OR cancellation_code IN ('PATIENT_REQUEST','STAFF_REQUEST','DUPLICATE','SERVICE_UNAVAILABLE','OTHER')),
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id,id),
  UNIQUE (organization_id,id,centre_id),
  UNIQUE (organization_id,public_id),
  UNIQUE (organization_id,idempotency_key),
  UNIQUE (organization_id,appointment_id),
  FOREIGN KEY (organization_id,centre_id) REFERENCES centres(organization_id,id),
  FOREIGN KEY (organization_id,patient_id) REFERENCES patients(organization_id,id),
  FOREIGN KEY (organization_id,appointment_id,centre_id) REFERENCES appointments(organization_id,id,centre_id),
  FOREIGN KEY (organization_id,created_by) REFERENCES users(organization_id,id),
  FOREIGN KEY (organization_id,updated_by) REFERENCES users(organization_id,id),
  CHECK ((status='CANCELLED') = (cancellation_code IS NOT NULL))
);
CREATE INDEX service_orders_centre_status ON service_orders (organization_id,centre_id,status,created_at DESC);
CREATE INDEX service_orders_patient_history ON service_orders (organization_id,patient_id,created_at DESC);

CREATE TABLE service_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  order_id uuid NOT NULL,
  test_id uuid,
  package_id uuid,
  item_code text NOT NULL,
  item_name text NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 100),
  unit_price_minor bigint CHECK (unit_price_minor IS NULL OR unit_price_minor >= 0),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,order_id,centre_id) REFERENCES service_orders(organization_id,id,centre_id),
  FOREIGN KEY (organization_id,test_id,centre_id) REFERENCES catalogue_tests(organization_id,id,centre_id),
  FOREIGN KEY (organization_id,package_id,centre_id) REFERENCES catalogue_packages(organization_id,id,centre_id),
  CHECK ((test_id IS NOT NULL)::integer + (package_id IS NOT NULL)::integer = 1)
);
CREATE INDEX service_order_items_order ON service_order_items (organization_id,order_id,created_at);

CREATE TABLE service_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  order_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('CREATED','ITEMS_UPDATED','STATUS_CHANGED')),
  previous_status text,
  new_status text NOT NULL,
  reason_code text,
  actor_user_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'INTERNAL',
  occurred_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id,order_id) REFERENCES service_orders(organization_id,id),
  FOREIGN KEY (organization_id,actor_user_id) REFERENCES users(organization_id,id)
);
CREATE INDEX service_order_events_history ON service_order_events (organization_id,order_id,occurred_at DESC);
CREATE TRIGGER service_order_events_append_only BEFORE UPDATE OR DELETE ON service_order_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();

COMMIT;
