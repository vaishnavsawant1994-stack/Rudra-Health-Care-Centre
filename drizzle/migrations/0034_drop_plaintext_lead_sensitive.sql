DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM leads l LEFT JOIN lead_private_data d ON d.lead_id=l.id AND d.organization_id=l.organization_id AND d.centre_id=l.centre_id WHERE d.lead_id IS NULL OR d.payload_ciphertext IS NULL OR ((l.phone IS NOT NULL) <> (d.phone_blind_index IS NOT NULL)) OR ((l.email IS NOT NULL) <> (d.email_blind_index IS NOT NULL))) THEN
    RAISE EXCEPTION 'lead encrypted-data backfill incomplete; run and verify the local lead backfill before cutover';
  END IF;
  IF EXISTS (SELECT 1 FROM lead_activities WHERE private_payload_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM lead_followups WHERE outcome_note IS NOT NULL AND outcome_note_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM lead_conversions WHERE identity_evidence_reference IS NOT NULL AND identity_evidence_ciphertext IS NULL) THEN
    RAISE EXCEPTION 'lead activity/follow-up/conversion encryption backfill incomplete; verify backfill before cutover';
  END IF;
END $$;

ALTER TABLE lead_private_data ALTER COLUMN payload_ciphertext SET NOT NULL;
ALTER TABLE lead_activities ALTER COLUMN private_payload_ciphertext SET NOT NULL;

DROP INDEX leads_phone_lookup_idx;
DROP INDEX leads_email_lookup_idx;
ALTER TABLE leads DROP COLUMN first_name, DROP COLUMN last_name, DROP COLUMN phone, DROP COLUMN email,
  DROP COLUMN interested_service, DROP COLUMN campaign, DROP COLUMN contact_evidence_reference,
  DROP COLUMN marketing_evidence_reference, DROP COLUMN lost_reason;
ALTER TABLE lead_activities DROP COLUMN body, DROP COLUMN metadata;
ALTER TABLE lead_followups DROP COLUMN outcome_note;
ALTER TABLE lead_conversions DROP COLUMN identity_evidence_reference;

COMMENT ON TABLE leads IS 'Lead workflow and relational metadata. Names, contacts, campaign/enquiry details and free-text evidence are stored encrypted in lead_private_data or event payload ciphertext.';
