ALTER TABLE patients ADD CONSTRAINT patients_id_org_centre_uq UNIQUE (id, organization_id, centre_id);

CREATE TABLE families (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  centre_id uuid NOT NULL,
  family_number varchar(24) NOT NULL,
  display_name varchar(140) NOT NULL CHECK (length(trim(display_name)) > 0),
  primary_contact_patient_id uuid,
  created_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT families_org_number_uq UNIQUE (organization_id, family_number),
  CONSTRAINT families_id_org_centre_uq UNIQUE (id, organization_id, centre_id),
  CONSTRAINT families_centre_org_fk FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT families_primary_contact_patient_fk FOREIGN KEY (primary_contact_patient_id, organization_id, centre_id) REFERENCES patients(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT families_creator_org_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT
);
CREATE INDEX families_centre_created_idx ON families(organization_id, centre_id, created_at DESC);

CREATE TABLE family_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  family_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  relationship varchar(32) NOT NULL CHECK (relationship IN ('SELF', 'SPOUSE', 'PARENT', 'CHILD', 'SIBLING', 'GUARDIAN', 'DEPENDENT', 'OTHER')),
  status varchar(24) NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (status IN ('PENDING_VERIFICATION', 'ACTIVE', 'ENDED')),
  authorization_basis varchar(32) CHECK (authorization_basis IS NULL OR authorization_basis IN ('PATIENT_SELF', 'LEGAL_GUARDIAN', 'OTHER_AUTHORIZED')),
  evidence_reference varchar(200),
  verified_by_staff_id uuid,
  verified_at timestamptz,
  created_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  ended_by_staff_id uuid,
  ended_at timestamptz,
  CONSTRAINT family_members_family_scope_fk FOREIGN KEY (family_id, organization_id, centre_id) REFERENCES families(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT family_members_patient_scope_fk FOREIGN KEY (patient_id, organization_id, centre_id) REFERENCES patients(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT family_members_creator_org_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT family_members_verifier_org_fk FOREIGN KEY (verified_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT family_members_ender_org_fk FOREIGN KEY (ended_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT family_members_not_self_family CHECK (relationship <> 'SELF' OR status IN ('PENDING_VERIFICATION', 'ACTIVE')),
  CONSTRAINT family_members_active_verified CHECK (status <> 'ACTIVE' OR (verified_at IS NOT NULL AND verified_by_staff_id IS NOT NULL AND evidence_reference IS NOT NULL AND authorization_basis IS NOT NULL)),
  CONSTRAINT family_members_ended_at CHECK (status <> 'ENDED' OR (ended_at IS NOT NULL AND ended_by_staff_id IS NOT NULL))
);
CREATE UNIQUE INDEX family_members_active_patient_uq ON family_members(family_id, patient_id) WHERE status IN ('PENDING_VERIFICATION', 'ACTIVE');
CREATE INDEX family_members_family_idx ON family_members(organization_id, family_id, status);
CREATE INDEX family_members_patient_idx ON family_members(organization_id, patient_id, status);

CREATE TABLE family_access_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  family_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  grantee_patient_id uuid NOT NULL,
  allowed_data jsonb NOT NULL CHECK (jsonb_typeof(allowed_data) = 'array' AND jsonb_array_length(allowed_data) > 0 AND allowed_data <@ '["DEMOGRAPHICS", "PATIENT_CONTACT", "APPOINTMENTS", "ORDERS", "REPORTS", "BILLING"]'::jsonb),
  purpose varchar(240) NOT NULL CHECK (length(trim(purpose)) > 0),
  authorization_basis varchar(32) NOT NULL CHECK (authorization_basis IN ('PATIENT_SELF', 'LEGAL_GUARDIAN', 'OTHER_AUTHORIZED')),
  status varchar(24) NOT NULL DEFAULT 'PENDING_VERIFICATION' CHECK (status IN ('PENDING_VERIFICATION', 'ACTIVE', 'REVOKED', 'EXPIRED')),
  effective_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  evidence_reference varchar(200),
  created_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_by_staff_id uuid,
  verified_at timestamptz,
  revoked_by_staff_id uuid,
  revoked_at timestamptz,
  CONSTRAINT family_access_grants_not_self CHECK (patient_id <> grantee_patient_id),
  CONSTRAINT family_access_grants_expiry CHECK (expires_at IS NULL OR expires_at > effective_at),
  CONSTRAINT family_access_grants_family_scope_fk FOREIGN KEY (family_id, organization_id, centre_id) REFERENCES families(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT family_access_grants_patient_scope_fk FOREIGN KEY (patient_id, organization_id, centre_id) REFERENCES patients(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT family_access_grants_grantee_scope_fk FOREIGN KEY (grantee_patient_id, organization_id, centre_id) REFERENCES patients(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT family_access_grants_creator_org_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT family_access_grants_verifier_org_fk FOREIGN KEY (verified_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT family_access_grants_revoker_org_fk FOREIGN KEY (revoked_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT family_access_grants_active_verified CHECK (status <> 'ACTIVE' OR (verified_at IS NOT NULL AND verified_by_staff_id IS NOT NULL AND evidence_reference IS NOT NULL)),
  CONSTRAINT family_access_grants_revoked_at CHECK (status <> 'REVOKED' OR (revoked_at IS NOT NULL AND revoked_by_staff_id IS NOT NULL))
);
CREATE UNIQUE INDEX family_access_grants_pair_active_uq ON family_access_grants(family_id, patient_id, grantee_patient_id) WHERE status IN ('PENDING_VERIFICATION', 'ACTIVE');
CREATE INDEX family_access_grants_family_status_idx ON family_access_grants(organization_id, family_id, status);
CREATE INDEX family_access_grants_patient_idx ON family_access_grants(organization_id, patient_id, grantee_patient_id);

COMMENT ON TABLE family_members IS 'Family association has independent verification and never grants patient data access.';
COMMENT ON TABLE family_access_grants IS 'Only ACTIVE grants with verified evidence, a valid time window and matching data scope may authorize a named grantee. Family membership alone is not access.';
