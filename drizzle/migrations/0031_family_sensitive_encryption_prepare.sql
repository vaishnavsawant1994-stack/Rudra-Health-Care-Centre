ALTER TABLE families ADD COLUMN display_name_ciphertext text, ADD COLUMN display_name_blind_index char(64);
ALTER TABLE family_members ADD COLUMN evidence_ciphertext text;
ALTER TABLE family_access_grants ADD COLUMN purpose_ciphertext text, ADD COLUMN evidence_ciphertext text;
ALTER TABLE family_contact_arrangements ADD COLUMN evidence_ciphertext text;
CREATE INDEX families_display_name_blind_idx ON families(organization_id,centre_id,display_name_blind_index);
COMMENT ON COLUMN families.display_name_blind_index IS 'Purpose-separated exact normalized family-name lookup token; it does not support fuzzy search.';
