DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rudra_dev_app') THEN
    REVOKE DELETE ON TABLE families, family_members, family_access_grants, family_contact_arrangements FROM rudra_dev_app;
  END IF;
END $$;

COMMENT ON TABLE families IS 'Family records are managed through audited status changes; the runtime role cannot delete family history.';
COMMENT ON TABLE family_members IS 'Membership changes are recorded as status transitions; the runtime role cannot delete family history.';
COMMENT ON TABLE family_access_grants IS 'Sharing grants are revoked by status transition; the runtime role cannot delete grant history.';
COMMENT ON TABLE family_contact_arrangements IS 'Contact arrangements are revoked by status transition; the runtime role cannot delete arrangement history.';
