ALTER TABLE public_enquiries DROP CONSTRAINT public_enquiries_status_check;
ALTER TABLE public_enquiries ALTER COLUMN status TYPE varchar(32);
ALTER TABLE public_enquiries ADD CONSTRAINT public_enquiries_status_check
  CHECK (status IN ('PENDING_REVIEW','CONVERTED_TO_LEAD','CONVERTED_TO_RELATIONSHIP','DISMISSED'));
ALTER TABLE public_enquiries DROP CONSTRAINT public_enquiries_review_state;
ALTER TABLE public_enquiries ADD CONSTRAINT public_enquiries_review_state CHECK (
  (status = 'PENDING_REVIEW' AND reviewed_by_staff_id IS NULL AND reviewed_at IS NULL AND resulting_lead_id IS NULL)
  OR (status = 'CONVERTED_TO_LEAD' AND reviewed_by_staff_id IS NOT NULL AND reviewed_at IS NOT NULL AND resulting_lead_id IS NOT NULL)
  OR (status = 'CONVERTED_TO_RELATIONSHIP' AND reviewed_by_staff_id IS NOT NULL AND reviewed_at IS NOT NULL AND resulting_lead_id IS NULL)
  OR (status = 'DISMISSED' AND reviewed_by_staff_id IS NOT NULL AND reviewed_at IS NOT NULL AND resulting_lead_id IS NULL)
);
ALTER TABLE public_enquiry_events DROP CONSTRAINT public_enquiry_events_event_type_check;
ALTER TABLE public_enquiry_events ALTER COLUMN event_type TYPE varchar(32);
ALTER TABLE public_enquiry_events ADD CONSTRAINT public_enquiry_events_event_type_check
  CHECK (event_type IN ('SUBMITTED','CONVERTED_TO_LEAD','CONVERTED_TO_RELATIONSHIP','DISMISSED'));

ALTER TABLE business_relationships ADD COLUMN source_public_enquiry_id uuid;
ALTER TABLE business_relationships ADD CONSTRAINT business_relationships_source_enquiry_uq UNIQUE(organization_id, source_public_enquiry_id);
ALTER TABLE business_relationships ADD CONSTRAINT business_relationships_source_enquiry_fk
  FOREIGN KEY(source_public_enquiry_id, organization_id, centre_id)
  REFERENCES public_enquiries(id, organization_id, centre_id) ON DELETE RESTRICT;

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='rudra_dev_app') THEN
  GRANT SELECT, INSERT, UPDATE ON business_relationships TO rudra_dev_app;
 END IF;
END $$;
