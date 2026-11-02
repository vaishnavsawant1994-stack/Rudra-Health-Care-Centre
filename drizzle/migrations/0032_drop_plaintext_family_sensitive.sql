DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM families WHERE display_name_ciphertext IS NULL OR display_name_blind_index IS NULL)
    OR EXISTS (SELECT 1 FROM family_members WHERE evidence_reference IS NOT NULL AND evidence_ciphertext IS NULL)
    OR EXISTS (SELECT 1 FROM family_access_grants WHERE purpose_ciphertext IS NULL OR (evidence_reference IS NOT NULL AND evidence_ciphertext IS NULL))
    OR EXISTS (SELECT 1 FROM family_contact_arrangements WHERE evidence_reference IS NOT NULL AND evidence_ciphertext IS NULL) THEN
    RAISE EXCEPTION 'family sensitive-data encryption backfill incomplete; run the verified family backfill before cutover';
  END IF;
END $$;
ALTER TABLE families ALTER COLUMN display_name_ciphertext SET NOT NULL, ALTER COLUMN display_name_blind_index SET NOT NULL;
ALTER TABLE family_access_grants ALTER COLUMN purpose_ciphertext SET NOT NULL;
ALTER TABLE families DROP COLUMN display_name;
ALTER TABLE family_members DROP COLUMN evidence_reference;
ALTER TABLE family_access_grants DROP COLUMN purpose, DROP COLUMN evidence_reference;
ALTER TABLE family_contact_arrangements DROP COLUMN evidence_reference;
