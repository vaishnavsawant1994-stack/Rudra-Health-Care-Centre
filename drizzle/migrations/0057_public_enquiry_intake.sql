CREATE TABLE public_enquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  enquiry_number varchar(28) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'PENDING_REVIEW' CHECK (status IN ('PENDING_REVIEW','CONVERTED_TO_LEAD','DISMISSED')),
  private_data_ciphertext text NOT NULL,
  phone_blind_index varchar(64),
  email_blind_index varchar(64),
  idempotency_key uuid NOT NULL,
  request_fingerprint varchar(64) NOT NULL,
  version_number integer NOT NULL DEFAULT 1 CHECK (version_number > 0),
  reviewed_by_staff_id uuid,
  reviewed_at timestamptz,
  resulting_lead_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_enquiries_id_org_centre_uq UNIQUE(id, organization_id, centre_id),
  CONSTRAINT public_enquiries_org_number_uq UNIQUE(organization_id, enquiry_number),
  CONSTRAINT public_enquiries_idempotency_uq UNIQUE(organization_id, idempotency_key),
  CONSTRAINT public_enquiries_centre_org_fk FOREIGN KEY(centre_id, organization_id) REFERENCES centres(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT public_enquiries_reviewer_fk FOREIGN KEY(reviewed_by_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT public_enquiries_lead_fk FOREIGN KEY(resulting_lead_id, organization_id, centre_id) REFERENCES leads(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT public_enquiries_review_state CHECK (
    (status = 'PENDING_REVIEW' AND reviewed_by_staff_id IS NULL AND reviewed_at IS NULL AND resulting_lead_id IS NULL)
    OR (status = 'CONVERTED_TO_LEAD' AND reviewed_by_staff_id IS NOT NULL AND reviewed_at IS NOT NULL AND resulting_lead_id IS NOT NULL)
    OR (status = 'DISMISSED' AND reviewed_by_staff_id IS NOT NULL AND reviewed_at IS NOT NULL AND resulting_lead_id IS NULL)
  )
);
CREATE INDEX public_enquiries_review_queue_idx ON public_enquiries(organization_id, centre_id, status, created_at DESC);
CREATE INDEX public_enquiries_phone_lookup_idx ON public_enquiries(organization_id, centre_id, phone_blind_index) WHERE phone_blind_index IS NOT NULL;
CREATE INDEX public_enquiries_email_lookup_idx ON public_enquiries(organization_id, centre_id, email_blind_index) WHERE email_blind_index IS NOT NULL;

CREATE TABLE public_enquiry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  centre_id uuid NOT NULL,
  enquiry_id uuid NOT NULL,
  event_type varchar(24) NOT NULL CHECK (event_type IN ('SUBMITTED','CONVERTED_TO_LEAD','DISMISSED')),
  private_data_ciphertext text NOT NULL,
  actor_staff_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT public_enquiry_events_enquiry_fk FOREIGN KEY(enquiry_id, organization_id, centre_id) REFERENCES public_enquiries(id, organization_id, centre_id) ON DELETE RESTRICT,
  CONSTRAINT public_enquiry_events_actor_fk FOREIGN KEY(actor_staff_id, organization_id) REFERENCES staff_users(id, organization_id) ON DELETE RESTRICT,
  CONSTRAINT public_enquiry_events_actor_rule CHECK ((event_type = 'SUBMITTED' AND actor_staff_id IS NULL) OR (event_type <> 'SUBMITTED' AND actor_staff_id IS NOT NULL))
);
CREATE INDEX public_enquiry_events_history_idx ON public_enquiry_events(organization_id, enquiry_id, recorded_at, id);
CREATE FUNCTION prevent_public_enquiry_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'public enquiry history is append-only'; END $$;
CREATE TRIGGER public_enquiry_events_append_only BEFORE UPDATE OR DELETE ON public_enquiry_events FOR EACH ROW EXECUTE FUNCTION prevent_public_enquiry_event_mutation();

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app') THEN
  GRANT SELECT, INSERT, UPDATE ON public_enquiries TO rudra_dev_app;
  REVOKE DELETE ON public_enquiries FROM rudra_dev_app;
  GRANT SELECT, INSERT ON public_enquiry_events TO rudra_dev_app;
  REVOKE UPDATE, DELETE ON public_enquiry_events FROM rudra_dev_app;
 END IF;
END $$;
