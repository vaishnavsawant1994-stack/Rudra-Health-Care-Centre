ALTER TABLE leads
  ADD COLUMN source_doctor_id uuid,
  ADD CONSTRAINT leads_source_doctor_attribution_check CHECK (
    source_doctor_id IS NULL
    OR (source = 'REFERRAL' AND source_relationship_id IS NULL AND source_relationship_type IS NULL)
  ),
  ADD CONSTRAINT leads_source_doctor_scope_fk FOREIGN KEY
    (source_doctor_id, organization_id, centre_id)
    REFERENCES doctor_profiles(id, organization_id, centre_id)
    ON DELETE RESTRICT;

CREATE INDEX leads_source_doctor_idx
  ON leads(organization_id, centre_id, source_doctor_id)
  WHERE source_doctor_id IS NOT NULL;
