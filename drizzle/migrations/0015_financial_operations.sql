CREATE TABLE finance_billing_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, centre_id uuid NOT NULL,
  charge_type varchar(24) NOT NULL CHECK (charge_type IN ('DIAGNOSTIC','HOME_COLLECTION')),
  issuer varchar(24) NOT NULL CHECK (issuer IN ('METROPOLIS','RUDRA','SEPARATE','PENDING')),
  legal_invoice_enabled boolean NOT NULL DEFAULT false CHECK (legal_invoice_enabled = false),
  version integer NOT NULL DEFAULT 1, updated_by_staff_id uuid NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, centre_id, charge_type),
  FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (updated_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE finance_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, centre_id uuid NOT NULL,
  order_id uuid, appointment_id uuid, charge_type varchar(24) NOT NULL CHECK (charge_type IN ('DIAGNOSTIC','HOME_COLLECTION','ADJUSTMENT')),
  charge_code varchar(80) NOT NULL, amount_minor bigint NOT NULL CHECK (amount_minor <> 0), currency varchar(3) NOT NULL DEFAULT 'INR' CHECK (currency='INR'),
  state varchar(16) NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','VOIDED')),
  snapshot jsonb NOT NULL, recorded_by_staff_id uuid NOT NULL, idempotency_key uuid NOT NULL, expected_version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, idempotency_key), UNIQUE (id, organization_id, centre_id),
  FOREIGN KEY (order_id, organization_id, centre_id) REFERENCES diagnostic_orders(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (appointment_id, organization_id, centre_id) REFERENCES appointments(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (recorded_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX finance_charges_scope_idx ON finance_charges(organization_id, centre_id, created_at DESC);
CREATE UNIQUE INDEX finance_charge_diagnostic_order_uq ON finance_charges(order_id) WHERE charge_type='DIAGNOSTIC' AND state='ACTIVE' AND order_id IS NOT NULL;
CREATE UNIQUE INDEX finance_charge_home_appointment_uq ON finance_charges(appointment_id) WHERE charge_type='HOME_COLLECTION' AND state='ACTIVE' AND appointment_id IS NOT NULL;

CREATE TABLE finance_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, centre_id uuid NOT NULL,
  payment_number varchar(32) NOT NULL, method varchar(20) NOT NULL CHECK (method IN ('CASH','UPI','CARD_TERMINAL','BANK_TRANSFER','OTHER')),
  status varchar(20) NOT NULL CHECK (status IN ('RECORDED','CONFIRMED','DISPUTED','REVERSED','PARTIALLY_REFUNDED','REFUNDED')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0), currency varchar(3) NOT NULL DEFAULT 'INR' CHECK (currency='INR'),
  reference varchar(200), received_by_staff_id uuid NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key uuid NOT NULL, version integer NOT NULL DEFAULT 1,
  UNIQUE (organization_id, payment_number), UNIQUE (organization_id, idempotency_key), UNIQUE(id, organization_id, centre_id),
  FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (received_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX finance_payments_scope_idx ON finance_payments(organization_id, centre_id, recorded_at DESC);

CREATE TABLE finance_allocations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, centre_id uuid NOT NULL,
  payment_id uuid NOT NULL, charge_id uuid NOT NULL, amount_minor bigint NOT NULL CHECK (amount_minor > 0), allocated_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (payment_id, organization_id, centre_id) REFERENCES finance_payments(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (charge_id, organization_id, centre_id) REFERENCES finance_charges(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (allocated_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX finance_allocations_charge_idx ON finance_allocations(organization_id, charge_id);
CREATE INDEX finance_allocations_payment_idx ON finance_allocations(organization_id, payment_id);

CREATE TABLE finance_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, centre_id uuid NOT NULL,
  charge_id uuid NOT NULL, amount_minor bigint NOT NULL CHECK (amount_minor <> 0), reason varchar(240) NOT NULL,
  approved_by_staff_id uuid NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (charge_id, organization_id, centre_id) REFERENCES finance_charges(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);

CREATE TABLE finance_refunds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, centre_id uuid NOT NULL,
  payment_id uuid NOT NULL, amount_minor bigint NOT NULL CHECK (amount_minor > 0), reason varchar(240) NOT NULL,
  status varchar(20) NOT NULL CHECK (status IN ('REQUESTED','APPROVED','REJECTED','EXECUTION_RECORDED')),
  requested_by_staff_id uuid NOT NULL, approved_by_staff_id uuid, executed_by_staff_id uuid,
  execution_reference varchar(200), created_at timestamptz NOT NULL DEFAULT now(), approved_at timestamptz, executed_at timestamptz,
  FOREIGN KEY (payment_id, organization_id, centre_id) REFERENCES finance_payments(id, organization_id, centre_id) ON DELETE RESTRICT,
  FOREIGN KEY (requested_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (approved_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (executed_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CHECK ((status NOT IN ('APPROVED','EXECUTION_RECORDED') OR (approved_by_staff_id IS NOT NULL AND approved_at IS NOT NULL)) AND (status <> 'EXECUTION_RECORDED' OR (executed_by_staff_id IS NOT NULL AND executed_at IS NOT NULL AND execution_reference IS NOT NULL)) AND (approved_by_staff_id IS NULL OR approved_by_staff_id <> requested_by_staff_id))
);

CREATE TABLE finance_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, centre_id uuid NOT NULL,
  event_type varchar(32) NOT NULL CHECK (event_type IN ('CHARGE_RECORDED','PAYMENT_RECORDED','PAYMENT_CONFIRMED','PAYMENT_DISPUTED','ADJUSTMENT_RECORDED','REFUND_REQUESTED','REFUND_APPROVED','REFUND_REJECTED','REFUND_EXECUTION_RECORDED','RECONCILIATION_CLOSED')),
  entity_type varchar(24) NOT NULL, entity_id uuid NOT NULL, amount_minor bigint, reason varchar(240),
  actor_staff_id uuid NOT NULL, source varchar(24) NOT NULL DEFAULT 'STAFF_RECORDED', recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX finance_events_timeline_idx ON finance_events(organization_id, centre_id, recorded_at DESC);

CREATE TABLE finance_reconciliations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), organization_id uuid NOT NULL, centre_id uuid NOT NULL,
  status varchar(16) NOT NULL CHECK (status IN ('OPEN','CLOSED')), opened_by_staff_id uuid NOT NULL, closed_by_staff_id uuid,
  opening_cash_minor bigint NOT NULL CHECK (opening_cash_minor >= 0), expected_cash_minor bigint,
  counted_cash_minor bigint, variance_minor bigint, handover_to_staff_id uuid, reason varchar(240),
  opened_at timestamptz NOT NULL DEFAULT now(), closed_at timestamptz, version integer NOT NULL DEFAULT 1,
  FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (opened_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (closed_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  FOREIGN KEY (handover_to_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CHECK ((status='OPEN' AND closed_at IS NULL) OR (status='CLOSED' AND closed_at IS NOT NULL AND expected_cash_minor IS NOT NULL AND counted_cash_minor IS NOT NULL AND variance_minor IS NOT NULL))
);
CREATE UNIQUE INDEX finance_one_open_recon_per_centre ON finance_reconciliations(organization_id, centre_id) WHERE status='OPEN';

CREATE FUNCTION finance_history_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'financial history is append-only'; END $$;
CREATE TRIGGER finance_events_immutable BEFORE UPDATE OR DELETE ON finance_events FOR EACH ROW EXECUTE FUNCTION finance_history_append_only();
CREATE TRIGGER finance_allocations_immutable BEFORE UPDATE OR DELETE ON finance_allocations FOR EACH ROW EXECUTE FUNCTION finance_history_append_only();
CREATE TRIGGER finance_adjustments_immutable BEFORE UPDATE OR DELETE ON finance_adjustments FOR EACH ROW EXECUTE FUNCTION finance_history_append_only();
CREATE TRIGGER finance_refunds_no_delete BEFORE DELETE ON finance_refunds FOR EACH ROW EXECUTE FUNCTION finance_history_append_only();
CREATE TRIGGER finance_reconciliation_closed_immutable BEFORE UPDATE OR DELETE ON finance_reconciliations FOR EACH ROW WHEN (OLD.status='CLOSED') EXECUTE FUNCTION finance_history_append_only();

INSERT INTO permissions (key, description, scope) VALUES
 ('finance.read','View financial records in authorized centres','CENTRE'),('finance.charge.create','Create internal charge snapshots','CENTRE'),
 ('finance.payment.record','Record manual payment evidence','CENTRE'),('finance.payment.verify','Confirm or dispute recorded payments','CENTRE'),
 ('finance.adjustment.manage','Record authorized financial adjustments','CENTRE'),('finance.refund.request','Request refunds or reversals','CENTRE'),
 ('finance.refund.approve','Approve refund requests','CENTRE'),('finance.refund.execute','Record refund execution evidence','CENTRE'),
 ('finance.reconcile','Close and reconcile a centre cash session','CENTRE'),('finance.policy.manage','Configure billing responsibility policy','ORGANIZATION')
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions(role_id, permission_id)
SELECT r.id,p.id FROM roles r JOIN permissions p ON p.key = ANY(CASE r.key
 WHEN 'owner_super_admin' THEN ARRAY['finance.read','finance.charge.create','finance.payment.record','finance.payment.verify','finance.adjustment.manage','finance.refund.request','finance.refund.approve','finance.refund.execute','finance.reconcile','finance.policy.manage']
 WHEN 'administrator' THEN ARRAY['finance.read','finance.charge.create','finance.payment.record','finance.payment.verify','finance.adjustment.manage','finance.refund.request','finance.refund.approve','finance.refund.execute','finance.reconcile','finance.policy.manage']
 WHEN 'centre_manager' THEN ARRAY['finance.read','finance.payment.record','finance.payment.verify','finance.adjustment.manage','finance.refund.request','finance.refund.approve','finance.refund.execute','finance.reconcile']
 WHEN 'receptionist' THEN ARRAY['finance.read','finance.charge.create','finance.payment.record']
 WHEN 'accounts' THEN ARRAY['finance.read','finance.charge.create','finance.payment.record','finance.payment.verify','finance.adjustment.manage','finance.refund.request','finance.refund.approve','finance.refund.execute','finance.reconcile']
 WHEN 'read_only_auditor' THEN ARRAY['finance.read'] ELSE ARRAY[]::text[] END)
ON CONFLICT (role_id,permission_id) DO NOTHING;

DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app') THEN
 REVOKE DELETE ON finance_billing_policies, finance_charges, finance_payments, finance_allocations, finance_adjustments, finance_refunds, finance_events, finance_reconciliations FROM rudra_dev_app;
 REVOKE UPDATE, DELETE ON finance_events, finance_allocations, finance_adjustments FROM rudra_dev_app;
END IF; END $$;

COMMENT ON TABLE finance_billing_policies IS 'Billing responsibility settings. Legal invoice issuance is intentionally prohibited pending approved policy.';
COMMENT ON TABLE finance_events IS 'Append-only internal financial event ledger; payment evidence is staff-recorded unless separately confirmed.';
