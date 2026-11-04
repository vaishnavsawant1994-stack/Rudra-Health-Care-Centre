CREATE TABLE lead_quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  centre_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  quote_number varchar(48) NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  status varchar(24) NOT NULL DEFAULT 'INTERNAL_DRAFT' CHECK (status = 'INTERNAL_DRAFT'),
  private_snapshot_ciphertext text NOT NULL,
  created_by_staff_id uuid NOT NULL,
  idempotency_key uuid NOT NULL,
  request_fingerprint varchar(64) NOT NULL CHECK (request_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_quotes_lead_scope_fk FOREIGN KEY (lead_id, organization_id, centre_id) REFERENCES leads(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT lead_quotes_creator_org_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT lead_quotes_id_scope_uq UNIQUE (id, organization_id, centre_id),
  CONSTRAINT lead_quotes_org_number_uq UNIQUE (organization_id, quote_number),
  CONSTRAINT lead_quotes_org_idempotency_uq UNIQUE (organization_id, idempotency_key),
  CONSTRAINT lead_quotes_lead_version_uq UNIQUE (organization_id, lead_id, version_number)
);
CREATE INDEX lead_quotes_lead_created_idx ON lead_quotes(organization_id, centre_id, lead_id, created_at);

CREATE FUNCTION prevent_lead_quote_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lead quote snapshots are append-only';
END $$;
CREATE TRIGGER lead_quotes_append_only BEFORE UPDATE OR DELETE ON lead_quotes
  FOR EACH ROW EXECUTE FUNCTION prevent_lead_quote_mutation();

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN
    GRANT SELECT, INSERT ON lead_quotes TO rudra_dev_app;
  END IF;
END $$;

COMMENT ON TABLE lead_quotes IS 'Append-only internal draft quote snapshots. No external communication, order confirmation, payment, invoice, or discount is implied.';
COMMENT ON COLUMN lead_quotes.private_snapshot_ciphertext IS 'Authenticated encrypted service, catalogue-version, price-source, effective-date, fee, and amount snapshot; amounts are not stored in searchable plaintext columns.';
