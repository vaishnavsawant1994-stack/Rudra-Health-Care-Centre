-- Legacy clean rows without an encryption key remain readable only as metadata;
-- application delivery is blocked. NOT VALID preserves them without permitting new unsafe rows.
ALTER TABLE report_documents
  ADD CONSTRAINT report_documents_clean_requires_encryption_key
  CHECK (scan_status <> 'CLEAN' OR encryption_key_id IS NOT NULL) NOT VALID;
