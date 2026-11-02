CREATE TYPE patient_consent_status AS ENUM ('GRANTED', 'DECLINED', 'WITHDRAWN');

CREATE TABLE patients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  centre_id uuid NOT NULL,
  patient_number varchar(24) NOT NULL,
  first_name varchar(100) NOT NULL,
  last_name varchar(100) NOT NULL,
  preferred_name varchar(100),
  date_of_birth date NOT NULL CHECK (date_of_birth <= CURRENT_DATE),
  sex_at_registration varchar(32),
  phone varchar(32) NOT NULL,
  email varchar(254),
  address jsonb,
  consent_status patient_consent_status NOT NULL,
  consent_recorded_at timestamptz NOT NULL,
  consent_method varchar(32) NOT NULL CHECK (consent_method IN ('IN_PERSON', 'PHONE', 'ONLINE', 'WRITTEN')),
  created_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patients_org_number_uq UNIQUE (organization_id, patient_number),
  CONSTRAINT patients_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT patients_centre_org_fk FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT patients_creator_org_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT patients_nonblank_name CHECK (length(trim(first_name)) > 0 AND length(trim(last_name)) > 0),
  CONSTRAINT patients_nonblank_phone CHECK (length(trim(phone)) > 0)
);
CREATE INDEX patients_centre_created_idx ON patients(organization_id, centre_id, created_at DESC);
CREATE INDEX patients_name_search_idx ON patients(organization_id, centre_id, last_name, first_name);
CREATE INDEX patients_phone_lookup_idx ON patients(organization_id, centre_id, phone);

CREATE TABLE patient_relationships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  patient_id uuid NOT NULL,
  related_patient_id uuid NOT NULL,
  relationship varchar(32) NOT NULL CHECK (relationship IN ('PARENT', 'CHILD', 'SPOUSE', 'SIBLING', 'GUARDIAN', 'DEPENDENT', 'OTHER')),
  status varchar(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'CONFIRMED', 'REVOKED')),
  created_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT patient_relationship_not_self CHECK (patient_id <> related_patient_id),
  CONSTRAINT patient_relationship_source_org_fk FOREIGN KEY (patient_id, organization_id) REFERENCES patients(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT patient_relationship_target_org_fk FOREIGN KEY (related_patient_id, organization_id) REFERENCES patients(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT patient_relationship_creator_org_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT patient_relationship_pair_uq UNIQUE (patient_id, related_patient_id, relationship)
);
CREATE INDEX patient_relationship_source_idx ON patient_relationships(organization_id, patient_id);

INSERT INTO permissions (key, description, scope) VALUES
  ('patients.read', 'View patient records within authorized centre scope', 'CENTRE'),
  ('patients.create', 'Register patients within authorized centre scope', 'CENTRE'),
  ('patients.update', 'Update patient records within authorized centre scope', 'CENTRE');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = ANY(CASE r.key
  WHEN 'owner_super_admin' THEN ARRAY['patients.read', 'patients.create', 'patients.update']
  WHEN 'administrator' THEN ARRAY['patients.read', 'patients.create', 'patients.update']
  WHEN 'centre_manager' THEN ARRAY['patients.read', 'patients.create', 'patients.update']
  WHEN 'receptionist' THEN ARRAY['patients.read', 'patients.create', 'patients.update']
  WHEN 'customer_support' THEN ARRAY['patients.read']
  ELSE ARRAY[]::text[]
END)
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMENT ON TABLE patients IS 'Personally identifying patient data. Every read/write must be authorized by organization and centre scope; query text and patient fields must not enter logs.';
COMMENT ON TABLE patient_relationships IS 'Family links do not grant access to a related adult patient record or clinical information.';
