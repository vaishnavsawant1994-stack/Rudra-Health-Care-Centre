ALTER TABLE patient_contact_secrets ADD COLUMN profile_ciphertext text;
COMMENT ON COLUMN patient_contact_secrets.profile_ciphertext IS 'Authenticated encryption of preferred name, date of birth, sex at registration, and address, bound to organization, centre and patient context.';
