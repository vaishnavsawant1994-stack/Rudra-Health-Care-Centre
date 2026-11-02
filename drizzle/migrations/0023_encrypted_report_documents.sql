ALTER TABLE report_documents
  ADD COLUMN encryption_key_id varchar(48);

ALTER TABLE report_documents
  DROP CONSTRAINT report_documents_scan_status_check,
  ADD CONSTRAINT report_documents_scan_status_check
    CHECK (scan_status IN ('SCANNING','CLEAN','QUARANTINED','SCAN_FAILED','REJECTED'));

-- Existing development artifacts predate at-rest encryption; force them to remain unavailable.
UPDATE report_documents
SET scan_status='QUARANTINED', encryption_key_id=NULL;

ALTER TABLE report_documents
  ADD CONSTRAINT report_documents_encryption_key_id_format
  CHECK (encryption_key_id IS NULL OR encryption_key_id ~ '^[A-Za-z0-9_-]{1,48}$');

COMMENT ON COLUMN report_documents.encryption_key_id IS 'Local key-ring identifier for AES-256-GCM encrypted private document bytes; null legacy records remain quarantined.';
