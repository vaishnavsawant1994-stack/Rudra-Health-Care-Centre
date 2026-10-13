-- Centre-scoped referral and service partners. Personal contact data is encrypted.
BEGIN;

CREATE TABLE partners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  public_id text NOT NULL,
  centre_id uuid NOT NULL,
  partner_type text NOT NULL CHECK (partner_type IN ('REFERRAL','COLLECTION','COMMUNITY','CORPORATE','OTHER')),
  name text NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 180),
  contact_name text CHECK (contact_name IS NULL OR length(trim(contact_name)) <= 180),
  contact_mobile_ciphertext bytea,
  contact_mobile_lookup_hash bytea,
  contact_mobile_mask text,
  contact_email_ciphertext bytea,
  notes text CHECK (notes IS NULL OR length(notes) <= 4000),
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','INACTIVE')),
  created_by uuid NOT NULL,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, id, centre_id),
  UNIQUE (organization_id, public_id),
  FOREIGN KEY (organization_id, centre_id) REFERENCES centres(organization_id, id),
  FOREIGN KEY (organization_id, created_by) REFERENCES users(organization_id, id),
  FOREIGN KEY (organization_id, updated_by) REFERENCES users(organization_id, id),
  CHECK ((contact_mobile_ciphertext IS NULL) = (contact_mobile_lookup_hash IS NULL)),
  CHECK ((contact_mobile_ciphertext IS NULL) = (contact_mobile_mask IS NULL))
);
CREATE UNIQUE INDEX partners_name_per_centre ON partners (organization_id, centre_id, partner_type, lower(name));
CREATE INDEX partners_centre_status ON partners (organization_id, centre_id, status, partner_type, lower(name));

ALTER TABLE patients ADD COLUMN referred_partner_id uuid;
ALTER TABLE patients ADD CONSTRAINT patients_referred_partner_centre_fk
  FOREIGN KEY (organization_id, referred_partner_id, primary_centre_id)
  REFERENCES partners(organization_id, id, centre_id);
ALTER TABLE patients ADD CONSTRAINT patients_partner_requires_centre
  CHECK (referred_partner_id IS NULL OR primary_centre_id IS NOT NULL);
ALTER TABLE leads ADD COLUMN partner_id uuid;
ALTER TABLE leads ADD CONSTRAINT leads_partner_centre_fk
  FOREIGN KEY (organization_id, partner_id, centre_id)
  REFERENCES partners(organization_id, id, centre_id);
ALTER TABLE leads ADD CONSTRAINT leads_partner_requires_centre
  CHECK (partner_id IS NULL OR centre_id IS NOT NULL);
CREATE INDEX patients_referred_partner ON patients (organization_id, referred_partner_id)
  WHERE referred_partner_id IS NOT NULL;
CREATE INDEX leads_partner ON leads (organization_id, partner_id)
  WHERE partner_id IS NOT NULL;

COMMIT;
