CREATE TABLE family_contact_arrangements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  family_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  channel varchar(12) NOT NULL CHECK (channel IN ('PHONE', 'EMAIL')),
  purpose varchar(32) NOT NULL CHECK (purpose IN ('GENERAL_FAMILY_CONTACT', 'BOOKING_UPDATES', 'APPOINTMENT_REMINDERS', 'BILLING_NOTICES')),
  status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'VERIFIED', 'REVOKED')),
  authorization_basis varchar(32) CHECK (authorization_basis IS NULL OR authorization_basis IN ('PATIENT_SELF', 'LEGAL_GUARDIAN', 'OTHER_AUTHORIZED')),
  evidence_reference varchar(200),
  created_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  verified_by_staff_id uuid,
  verified_at timestamptz,
  revoked_by_staff_id uuid,
  revoked_at timestamptz,
  CONSTRAINT family_contact_arrangements_scope_fk FOREIGN KEY (family_id, organization_id, centre_id) REFERENCES families(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT family_contact_arrangements_member_scope_fk FOREIGN KEY (patient_id, organization_id, centre_id) REFERENCES patients(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT family_contact_arrangements_creator_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT family_contact_arrangements_verifier_fk FOREIGN KEY (verified_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT family_contact_arrangements_revoker_fk FOREIGN KEY (revoked_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT family_contact_arrangements_verified_fields CHECK (status <> 'VERIFIED' OR (verified_by_staff_id IS NOT NULL AND verified_at IS NOT NULL AND evidence_reference IS NOT NULL AND authorization_basis IS NOT NULL)),
  CONSTRAINT family_contact_arrangements_revoked_fields CHECK (status <> 'REVOKED' OR (revoked_by_staff_id IS NOT NULL AND revoked_at IS NOT NULL))
);
CREATE UNIQUE INDEX family_contact_arrangements_active_uq ON family_contact_arrangements(family_id, patient_id, channel, purpose) WHERE status IN ('PENDING', 'VERIFIED');
CREATE INDEX family_contact_arrangements_family_idx ON family_contact_arrangements(organization_id, family_id, status);

COMMENT ON TABLE family_contact_arrangements IS 'References a patient contact channel without copying contact details. A primary contact or family link alone never authorizes communication.';
