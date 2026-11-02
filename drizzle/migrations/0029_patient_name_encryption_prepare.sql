ALTER TABLE patient_contact_secrets
  ADD COLUMN name_ciphertext text,
  ADD COLUMN first_name_blind_index char(64),
  ADD COLUMN last_name_blind_index char(64),
  ADD COLUMN full_name_blind_index char(64);

CREATE INDEX patient_name_first_blind_idx ON patient_contact_secrets(organization_id, centre_id, first_name_blind_index);
CREATE INDEX patient_name_last_blind_idx ON patient_contact_secrets(organization_id, centre_id, last_name_blind_index);
CREATE INDEX patient_name_full_blind_idx ON patient_contact_secrets(organization_id, centre_id, full_name_blind_index);

COMMENT ON COLUMN patient_contact_secrets.name_ciphertext IS 'AES-GCM protected first/last patient names, bound to organization, centre, patient and name field context.';
COMMENT ON COLUMN patient_contact_secrets.first_name_blind_index IS 'Purpose-separated exact normalized first-name lookup token; does not support fuzzy search.';
COMMENT ON COLUMN patient_contact_secrets.last_name_blind_index IS 'Purpose-separated exact normalized last-name lookup token; does not support fuzzy search.';
COMMENT ON COLUMN patient_contact_secrets.full_name_blind_index IS 'Purpose-separated exact normalized full-name lookup token; does not support fuzzy search.';
