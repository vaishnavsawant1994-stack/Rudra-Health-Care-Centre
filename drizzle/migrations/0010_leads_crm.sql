CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  centre_id uuid NOT NULL,
  lead_number varchar(24) NOT NULL,
  first_name varchar(100) NOT NULL CHECK (length(trim(first_name)) > 0),
  last_name varchar(100) NOT NULL CHECK (length(trim(last_name)) > 0),
  phone varchar(32),
  email varchar(254),
  enquiry_category varchar(24) NOT NULL CHECK (enquiry_category IN ('TEST', 'PACKAGE', 'HOME_COLLECTION', 'GENERAL', 'OTHER')),
  interested_service varchar(160),
  home_collection_interest boolean NOT NULL DEFAULT false,
  source varchar(24) NOT NULL CHECK (source IN ('MANUAL', 'WEBSITE', 'WALK_IN', 'PHONE', 'REFERRAL', 'PARTNER', 'WHATSAPP', 'CAMPAIGN')),
  campaign varchar(120),
  status varchar(24) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONTACTED', 'QUALIFIED', 'FOLLOW_UP', 'CONVERTED', 'LOST', 'DUPLICATE', 'DO_NOT_CONTACT')),
  priority varchar(12) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'URGENT')),
  assigned_staff_id uuid NOT NULL,
  preferred_channel varchar(12) NOT NULL DEFAULT 'PHONE' CHECK (preferred_channel IN ('PHONE', 'EMAIL', 'WHATSAPP', 'NONE')),
  contact_permission varchar(24) NOT NULL DEFAULT 'PENDING' CHECK (contact_permission IN ('PENDING', 'AUTHORIZED', 'WITHDRAWN', 'DO_NOT_CONTACT')),
  contact_evidence_reference varchar(200),
  contact_permission_recorded_by uuid,
  contact_permission_recorded_at timestamptz,
  marketing_consent varchar(20) NOT NULL DEFAULT 'NOT_REQUESTED' CHECK (marketing_consent IN ('NOT_REQUESTED', 'GRANTED', 'WITHDRAWN')),
  marketing_evidence_reference varchar(200),
  marketing_consent_recorded_by uuid,
  marketing_consent_recorded_at timestamptz,
  lost_reason varchar(240),
  duplicate_of_lead_id uuid,
  converted_at timestamptz,
  created_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT leads_org_number_uq UNIQUE (organization_id, lead_number),
  CONSTRAINT leads_id_org_uq UNIQUE (id, organization_id),
  CONSTRAINT leads_id_org_centre_uq UNIQUE (id, organization_id, centre_id),
  CONSTRAINT leads_centre_org_fk FOREIGN KEY (centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT leads_assignee_org_fk FOREIGN KEY (assigned_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT leads_creator_org_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT leads_contact_recorder_org_fk FOREIGN KEY (contact_permission_recorded_by, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT leads_marketing_recorder_org_fk FOREIGN KEY (marketing_consent_recorded_by, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT leads_duplicate_org_fk FOREIGN KEY (duplicate_of_lead_id, organization_id) REFERENCES leads(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT leads_contact_required CHECK (phone IS NOT NULL OR email IS NOT NULL),
  CONSTRAINT leads_not_own_duplicate CHECK (duplicate_of_lead_id IS NULL OR duplicate_of_lead_id <> id),
  CONSTRAINT leads_contact_evidence CHECK (contact_permission <> 'AUTHORIZED' OR (contact_evidence_reference IS NOT NULL AND contact_permission_recorded_by IS NOT NULL AND contact_permission_recorded_at IS NOT NULL)),
  CONSTRAINT leads_marketing_evidence CHECK (marketing_consent <> 'GRANTED' OR (marketing_evidence_reference IS NOT NULL AND marketing_consent_recorded_by IS NOT NULL AND marketing_consent_recorded_at IS NOT NULL)),
  CONSTRAINT leads_converted_at CHECK (status <> 'CONVERTED' OR converted_at IS NOT NULL)
);
CREATE INDEX leads_centre_created_idx ON leads(organization_id, centre_id, created_at DESC);
CREATE INDEX leads_centre_status_idx ON leads(organization_id, centre_id, status, updated_at DESC);
CREATE INDEX leads_assignee_status_idx ON leads(organization_id, assigned_staff_id, status, updated_at DESC);
CREATE INDEX leads_phone_lookup_idx ON leads(organization_id, centre_id, phone) WHERE phone IS NOT NULL;
CREATE INDEX leads_email_lookup_idx ON leads(organization_id, centre_id, lower(email)) WHERE email IS NOT NULL;

CREATE TABLE lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  actor_staff_id uuid NOT NULL,
  activity_type varchar(24) NOT NULL CHECK (activity_type IN ('CREATED', 'UPDATED', 'STATUS_CHANGED', 'NOTE', 'CONTACT_ATTEMPT', 'CONSENT_CHANGED', 'ASSIGNED', 'FOLLOW_UP_CREATED', 'FOLLOW_UP_COMPLETED', 'CONVERTED', 'REOPENED')),
  body varchar(1000),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_activities_lead_scope_fk FOREIGN KEY (lead_id, organization_id, centre_id) REFERENCES leads(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT lead_activities_actor_org_fk FOREIGN KEY (actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT lead_activities_note_body CHECK (activity_type <> 'NOTE' OR (body IS NOT NULL AND length(trim(body)) > 0))
);
CREATE INDEX lead_activities_timeline_idx ON lead_activities(organization_id, lead_id, recorded_at DESC);

CREATE TABLE lead_followups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  lead_id uuid NOT NULL,
  assigned_staff_id uuid NOT NULL,
  due_at timestamptz NOT NULL,
  task_type varchar(20) NOT NULL DEFAULT 'ADMINISTRATIVE' CHECK (task_type IN ('ADMINISTRATIVE', 'CONTACT')),
  status varchar(16) NOT NULL DEFAULT 'SCHEDULED' CHECK (status IN ('SCHEDULED', 'COMPLETED', 'UNSUCCESSFUL', 'CANCELLED')),
  outcome varchar(32) CHECK (outcome IS NULL OR outcome IN ('CONTACTED', 'NO_ANSWER', 'CALLBACK_REQUESTED', 'NOT_INTERESTED', 'OTHER')),
  outcome_note varchar(500),
  created_by_staff_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_by_staff_id uuid,
  completed_at timestamptz,
  CONSTRAINT lead_followups_lead_scope_fk FOREIGN KEY (lead_id, organization_id, centre_id) REFERENCES leads(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT lead_followups_assignee_org_fk FOREIGN KEY (assigned_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT lead_followups_creator_org_fk FOREIGN KEY (created_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT lead_followups_completer_org_fk FOREIGN KEY (completed_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT lead_followups_completed_fields CHECK (status NOT IN ('COMPLETED', 'UNSUCCESSFUL') OR (completed_by_staff_id IS NOT NULL AND completed_at IS NOT NULL)),
  CONSTRAINT lead_followups_outcome CHECK ((status IN ('COMPLETED', 'UNSUCCESSFUL') AND outcome IS NOT NULL) OR (status NOT IN ('COMPLETED', 'UNSUCCESSFUL') AND outcome IS NULL))
);
CREATE INDEX lead_followups_due_idx ON lead_followups(organization_id, centre_id, status, due_at);
CREATE INDEX lead_followups_assignee_due_idx ON lead_followups(organization_id, assigned_staff_id, status, due_at);

CREATE TABLE lead_conversions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  lead_id uuid NOT NULL UNIQUE,
  patient_id uuid NOT NULL,
  conversion_mode varchar(12) NOT NULL CHECK (conversion_mode IN ('NEW', 'EXISTING')),
  identity_evidence_reference varchar(200),
  converted_by_staff_id uuid NOT NULL,
  converted_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_conversions_lead_scope_fk FOREIGN KEY (lead_id, organization_id, centre_id) REFERENCES leads(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT lead_conversions_patient_scope_fk FOREIGN KEY (patient_id, organization_id, centre_id) REFERENCES patients(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT lead_conversions_actor_org_fk FOREIGN KEY (converted_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT lead_conversions_existing_evidence CHECK (conversion_mode <> 'EXISTING' OR identity_evidence_reference IS NOT NULL)
);
CREATE INDEX lead_conversions_patient_idx ON lead_conversions(organization_id, patient_id);

CREATE FUNCTION prevent_lead_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'lead history is append-only';
END;
$$;
CREATE TRIGGER lead_activities_append_only BEFORE UPDATE OR DELETE ON lead_activities FOR EACH ROW EXECUTE FUNCTION prevent_lead_history_mutation();
CREATE TRIGGER lead_conversions_append_only BEFORE UPDATE OR DELETE ON lead_conversions FOR EACH ROW EXECUTE FUNCTION prevent_lead_history_mutation();

INSERT INTO permissions (key, description, scope) VALUES
  ('leads.read', 'View lead contact records in authorized centres', 'CENTRE'),
  ('leads.create', 'Create enquiry records in authorized centres', 'CENTRE'),
  ('leads.update', 'Update lead status and operational details', 'CENTRE'),
  ('leads.assign', 'Assign leads and follow-ups to authorized staff', 'CENTRE'),
  ('leads.reopen', 'Reopen closed or do-not-contact lead records with authorization', 'CENTRE'),
  ('leads.convert', 'Convert an eligible lead to a patient', 'CENTRE'),
  ('leads.marketing_consent', 'Record and manage separate marketing permission', 'CENTRE'),
  ('leads.activities.write', 'Record lead activity and contact attempts', 'CENTRE'),
  ('leads.followups.manage', 'Schedule, assign, reschedule and complete follow-ups', 'CENTRE');

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r
JOIN permissions p ON p.key = ANY(CASE r.key
  WHEN 'owner_super_admin' THEN ARRAY['leads.read', 'leads.create', 'leads.update', 'leads.assign', 'leads.reopen', 'leads.convert', 'leads.marketing_consent', 'leads.activities.write', 'leads.followups.manage']
  WHEN 'administrator' THEN ARRAY['leads.read', 'leads.create', 'leads.update', 'leads.assign', 'leads.reopen', 'leads.convert', 'leads.marketing_consent', 'leads.activities.write', 'leads.followups.manage']
  WHEN 'centre_manager' THEN ARRAY['leads.read', 'leads.create', 'leads.update', 'leads.assign', 'leads.reopen', 'leads.convert', 'leads.marketing_consent', 'leads.activities.write', 'leads.followups.manage']
  WHEN 'receptionist' THEN ARRAY['leads.read', 'leads.create', 'leads.update', 'leads.convert', 'leads.activities.write', 'leads.followups.manage']
  WHEN 'customer_support' THEN ARRAY['leads.read', 'leads.update', 'leads.activities.write', 'leads.followups.manage']
  WHEN 'sales_marketing' THEN ARRAY['leads.read', 'leads.create', 'leads.update', 'leads.marketing_consent', 'leads.activities.write', 'leads.followups.manage']
  ELSE ARRAY[]::text[]
END)
ON CONFLICT (role_id, permission_id) DO NOTHING;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN
    REVOKE DELETE ON TABLE leads, lead_followups FROM rudra_dev_app;
    REVOKE UPDATE, DELETE ON TABLE lead_activities, lead_conversions FROM rudra_dev_app;
  END IF;
END $$;

COMMENT ON TABLE leads IS 'Operational enquiries only. Do not store health details. Contact authorization and marketing consent are separate.';
COMMENT ON TABLE lead_activities IS 'Append-only CRM activity history. Keep notes operational and free of unnecessary medical details.';
COMMENT ON TABLE lead_followups IS 'Staff follow-up tasks only. Contact attempts require active contact authorization.';
COMMENT ON TABLE lead_conversions IS 'One immutable conversion outcome per lead, linked to a patient in the same organization and centre.';
