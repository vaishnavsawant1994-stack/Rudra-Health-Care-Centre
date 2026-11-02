ALTER TABLE leads DROP CONSTRAINT leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check
  CHECK (source IN ('MANUAL','WEBSITE','WALK_IN','PHONE','REFERRAL','PARTNER','CORPORATE','WHATSAPP','CAMPAIGN'));

ALTER TABLE leads
  ADD COLUMN source_relationship_id uuid,
  ADD COLUMN source_relationship_type varchar(16),
  ADD CONSTRAINT leads_source_relationship_pair_check CHECK (
    (source_relationship_id IS NULL AND source_relationship_type IS NULL)
    OR (source_relationship_id IS NOT NULL AND source_relationship_type IS NOT NULL AND source_relationship_type IN ('CORPORATE','PARTNER'))
  ),
  ADD CONSTRAINT leads_source_relationship_type_check CHECK (
    source_relationship_id IS NULL
    OR (source = 'CORPORATE' AND source_relationship_type = 'CORPORATE')
    OR (source = 'PARTNER' AND source_relationship_type = 'PARTNER')
  ),
  ADD CONSTRAINT leads_source_relationship_scope_fk FOREIGN KEY
    (source_relationship_id, organization_id, centre_id, source_relationship_type)
    REFERENCES business_relationships(id, organization_id, centre_id, relationship_type)
    ON DELETE RESTRICT;

CREATE INDEX leads_source_relationship_idx
  ON leads(organization_id, centre_id, source_relationship_type, source_relationship_id)
  WHERE source_relationship_id IS NOT NULL;
