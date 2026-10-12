BEGIN;
CREATE TABLE leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  public_id text NOT NULL,
  centre_id uuid,
  first_name text,
  last_name text,
  mobile_ciphertext bytea,
  mobile_lookup_hash bytea,
  mobile_mask text,
  email_ciphertext bytea,
  source text NOT NULL,
  campaign_id uuid,
  interested_service text,
  assigned_staff_id uuid REFERENCES users(id),
  status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW','CONTACTED','INTERESTED','FOLLOW_UP','CONVERTED','LOST')),
  priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW','NORMAL','HIGH','URGENT')),
  next_follow_up_at timestamptz,
  converted_patient_id uuid,
  converted_order_id uuid,
  lost_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  FOREIGN KEY (organization_id, centre_id) REFERENCES centres(organization_id, id),
  FOREIGN KEY (organization_id, converted_patient_id) REFERENCES patients(organization_id, id),
  UNIQUE (organization_id, public_id),
  CHECK ((status = 'CONVERTED') = (converted_patient_id IS NOT NULL)),
  CHECK (status <> 'LOST' OR lost_reason IS NOT NULL)
);
CREATE INDEX leads_pipeline ON leads (organization_id, centre_id, status, next_follow_up_at);
CREATE INDEX leads_mobile_lookup ON leads (organization_id, mobile_lookup_hash) WHERE mobile_lookup_hash IS NOT NULL;
CREATE TABLE lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  lead_id uuid NOT NULL REFERENCES leads(id),
  activity_type text NOT NULL,
  note text NOT NULL,
  performed_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  consent_type text NOT NULL CHECK (consent_type IN ('PRIVACY_NOTICE','TERMS','SERVICE_WHATSAPP','MARKETING_WHATSAPP','SERVICE_SMS','MARKETING_SMS','SERVICE_CALL','MARKETING_CALL','EMAIL','AI_CALL','CALL_RECORDING','REPORT_DELIVERY')),
  current_value text NOT NULL CHECK (current_value IN ('GRANTED','DENIED','WITHDRAWN','NOT_REQUESTED')),
  source text NOT NULL,
  notice_version text,
  captured_at timestamptz NOT NULL,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, patient_id) REFERENCES patients(organization_id, id)
);
CREATE INDEX consent_current_by_patient ON consents (organization_id, patient_id, consent_type, captured_at DESC);
CREATE TABLE consent_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  patient_id uuid NOT NULL,
  consent_id uuid NOT NULL REFERENCES consents(id),
  consent_type text NOT NULL,
  previous_value text,
  new_value text NOT NULL,
  source text NOT NULL,
  captured_by uuid REFERENCES users(id),
  event_at timestamptz NOT NULL DEFAULT now(),
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (organization_id, patient_id) REFERENCES patients(organization_id, id)
);
CREATE TABLE audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id),
  actor_user_id uuid REFERENCES users(id),
  actor_type text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  centre_id uuid,
  purpose text,
  before_json jsonb,
  after_json jsonb,
  ip_address inet,
  user_agent text,
  request_id text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('SUCCESS','DENIED','FAILURE')),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (organization_id, centre_id) REFERENCES centres(organization_id, id)
);
CREATE INDEX audit_entity_history ON audit_events (organization_id, entity_type, entity_id, created_at DESC);
CREATE INDEX audit_actor_history ON audit_events (organization_id, actor_user_id, created_at DESC);
CREATE FUNCTION reject_append_only_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'append-only records cannot be changed'; END;
$$;
CREATE TRIGGER audit_events_append_only BEFORE UPDATE OR DELETE ON audit_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
CREATE TRIGGER consent_events_append_only BEFORE UPDATE OR DELETE ON consent_events FOR EACH ROW EXECUTE FUNCTION reject_append_only_mutation();
COMMIT;
