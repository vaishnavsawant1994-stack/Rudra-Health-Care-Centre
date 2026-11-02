CREATE TABLE diagnostic_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  order_number varchar(30) NOT NULL,
  patient_id uuid NOT NULL,
  appointment_id uuid,
  status varchar(24) NOT NULL CHECK (status IN ('DRAFT','PENDING_VERIFICATION','CONFIRMED','CANCELLED')),
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  idempotency_key uuid NOT NULL,
  request_hash varchar(64) NOT NULL,
  currency varchar(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  total_amount numeric(12,2),
  created_by_staff_id uuid NOT NULL,
  confirmed_by_staff_id uuid,
  confirmed_at timestamptz,
  cancellation_reason varchar(240),
  cancelled_by_staff_id uuid,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, order_number),
  UNIQUE (organization_id, idempotency_key),
  UNIQUE (id, organization_id, centre_id),
  FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (patient_id, organization_id, centre_id) REFERENCES patients(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (appointment_id, organization_id, centre_id) REFERENCES appointments(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (confirmed_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (cancelled_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CHECK (status <> 'CONFIRMED' OR (confirmed_by_staff_id IS NOT NULL AND confirmed_at IS NOT NULL AND total_amount IS NOT NULL)),
  CHECK (status <> 'CANCELLED' OR (cancelled_by_staff_id IS NOT NULL AND cancelled_at IS NOT NULL AND cancellation_reason IS NOT NULL)),
  CHECK (total_amount IS NULL OR total_amount >= 0)
);
CREATE UNIQUE INDEX diagnostic_orders_appointment_uq ON diagnostic_orders(organization_id, appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX diagnostic_orders_centre_status_idx ON diagnostic_orders(organization_id, centre_id, status, created_at DESC);
CREATE INDEX diagnostic_orders_patient_idx ON diagnostic_orders(organization_id, patient_id, created_at DESC);

CREATE TABLE diagnostic_order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  order_id uuid NOT NULL,
  catalogue_item_id uuid NOT NULL,
  catalogue_version_id uuid NOT NULL,
  service_type varchar(12) NOT NULL CHECK (service_type IN ('TEST','PACKAGE')),
  service_code varchar(80) NOT NULL,
  display_name varchar(180) NOT NULL,
  verification_status varchar(16) NOT NULL CHECK (verification_status IN ('SYNTHETIC','UNVERIFIED','VERIFIED','INACTIVE')),
  price_amount numeric(12,2),
  currency varchar(3) NOT NULL DEFAULT 'INR' CHECK (currency = 'INR'),
  price_source_reference varchar(200),
  effective_from date,
  effective_until date,
  service_snapshot jsonb NOT NULL,
  removed_at timestamptz,
  removed_by_staff_id uuid,
  removal_reason varchar(240),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (order_id, organization_id, centre_id) REFERENCES diagnostic_orders(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (catalogue_item_id, organization_id, centre_id) REFERENCES diagnostic_catalogue_items(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (catalogue_version_id, organization_id, centre_id) REFERENCES diagnostic_catalogue_versions(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (removed_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CHECK (price_amount IS NULL OR price_amount >= 0),
  CHECK (verification_status <> 'VERIFIED' OR (price_amount IS NOT NULL AND price_source_reference IS NOT NULL AND effective_from IS NOT NULL)),
  CHECK ((removed_at IS NULL AND removed_by_staff_id IS NULL AND removal_reason IS NULL) OR (removed_at IS NOT NULL AND removed_by_staff_id IS NOT NULL AND removal_reason IS NOT NULL))
);
CREATE INDEX diagnostic_order_items_order_idx ON diagnostic_order_items(organization_id, order_id);
CREATE UNIQUE INDEX diagnostic_order_items_active_item_uq ON diagnostic_order_items(order_id, catalogue_item_id) WHERE removed_at IS NULL;

CREATE TABLE diagnostic_order_status_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  order_id uuid NOT NULL,
  from_status varchar(24),
  to_status varchar(24) NOT NULL CHECK (to_status IN ('DRAFT','PENDING_VERIFICATION','CONFIRMED','CANCELLED')),
  reason varchar(240) NOT NULL,
  version_number integer NOT NULL,
  actor_staff_id uuid NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (order_id, organization_id, centre_id) REFERENCES diagnostic_orders(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX diagnostic_order_history_idx ON diagnostic_order_status_history(organization_id, order_id, recorded_at);

CREATE FUNCTION prevent_diagnostic_order_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'diagnostic order history is append-only'; END;
$$;
CREATE FUNCTION protect_diagnostic_order_items() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_state varchar(24);
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'diagnostic order items are retained as history'; END IF;
  SELECT status INTO order_state FROM diagnostic_orders WHERE id = NEW.order_id FOR UPDATE;
  IF order_state IN ('CONFIRMED','CANCELLED') THEN RAISE EXCEPTION 'confirmed or historical order items are immutable'; END IF;
  IF TG_OP = 'UPDATE' AND (OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL OR NEW.id IS DISTINCT FROM OLD.id OR NEW.organization_id IS DISTINCT FROM OLD.organization_id OR NEW.centre_id IS DISTINCT FROM OLD.centre_id OR NEW.order_id IS DISTINCT FROM OLD.order_id OR NEW.catalogue_item_id IS DISTINCT FROM OLD.catalogue_item_id OR NEW.catalogue_version_id IS DISTINCT FROM OLD.catalogue_version_id OR NEW.service_type IS DISTINCT FROM OLD.service_type OR NEW.service_code IS DISTINCT FROM OLD.service_code OR NEW.display_name IS DISTINCT FROM OLD.display_name OR NEW.verification_status IS DISTINCT FROM OLD.verification_status OR NEW.price_amount IS DISTINCT FROM OLD.price_amount OR NEW.currency IS DISTINCT FROM OLD.currency OR NEW.price_source_reference IS DISTINCT FROM OLD.price_source_reference OR NEW.effective_from IS DISTINCT FROM OLD.effective_from OR NEW.effective_until IS DISTINCT FROM OLD.effective_until OR NEW.service_snapshot IS DISTINCT FROM OLD.service_snapshot OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN RAISE EXCEPTION 'order item snapshots are immutable; mark the draft item removed'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER diagnostic_order_history_append_only BEFORE UPDATE OR DELETE ON diagnostic_order_status_history FOR EACH ROW EXECUTE FUNCTION prevent_diagnostic_order_history_mutation();
CREATE TRIGGER diagnostic_order_items_immutable BEFORE INSERT OR UPDATE OR DELETE ON diagnostic_order_items FOR EACH ROW EXECUTE FUNCTION protect_diagnostic_order_items();

INSERT INTO permissions (key, description, scope) VALUES
  ('orders.read', 'View diagnostic orders in an authorized centre', 'CENTRE'),
  ('orders.create', 'Create and maintain diagnostic order drafts', 'CENTRE'),
  ('orders.confirm', 'Confirm source-verified diagnostic orders', 'CENTRE'),
  ('orders.cancel', 'Cancel diagnostic orders with a reason', 'CENTRE')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r JOIN permissions p ON p.key = ANY(CASE r.key
 WHEN 'owner_super_admin' THEN ARRAY['orders.read','orders.create','orders.confirm','orders.cancel']
 WHEN 'administrator' THEN ARRAY['orders.read','orders.create','orders.confirm','orders.cancel']
 WHEN 'centre_manager' THEN ARRAY['orders.read','orders.create','orders.confirm','orders.cancel']
 WHEN 'receptionist' THEN ARRAY['orders.read','orders.create']
 WHEN 'read_only_auditor' THEN ARRAY['orders.read']
 WHEN 'phlebotomist' THEN ARRAY['orders.read']
 ELSE ARRAY[]::text[] END)
ON CONFLICT (role_id, permission_id) DO NOTHING;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN
    REVOKE DELETE ON TABLE diagnostic_orders, diagnostic_order_items, diagnostic_order_status_history FROM rudra_dev_app;
    REVOKE UPDATE, DELETE ON TABLE diagnostic_order_status_history FROM rudra_dev_app;
    REVOKE DELETE ON TABLE diagnostic_order_items FROM rudra_dev_app;
  END IF;
END $$;

COMMENT ON TABLE diagnostic_order_items IS 'Catalogue version snapshots; immutable once an order is confirmed and retained after cancellation.';
COMMENT ON TABLE diagnostic_order_status_history IS 'Append-only status history for diagnostic order intake only; no sample or laboratory lifecycle is implied.';
