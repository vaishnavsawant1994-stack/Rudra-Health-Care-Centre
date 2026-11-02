ALTER TABLE lead_communication_drafts
  ADD COLUMN template_id uuid,
  ADD COLUMN template_version integer;

ALTER TABLE lead_communication_drafts
  ADD CONSTRAINT lead_communication_drafts_template_version_check
    CHECK ((template_id IS NULL AND template_version IS NULL)
       OR (template_id IS NOT NULL AND template_version > 0)),
  ADD CONSTRAINT lead_communication_drafts_template_scope_fk
    FOREIGN KEY (template_id, organization_id, centre_id)
    REFERENCES communication_templates (id, organization_id, centre_id)
    ON DELETE RESTRICT;

COMMENT ON COLUMN lead_communication_drafts.template_id IS
  'Optional source communication template; template content is snapshotted into encrypted body_ciphertext and never auto-sent.';
