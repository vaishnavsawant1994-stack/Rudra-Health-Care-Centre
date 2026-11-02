-- Run manually in an authenticated psql session as the local PostgreSQL administrator.
-- This file contains no passwords and is not executed by application startup.
-- It only provisions the exact fresh Rudra database and role names used by .env.example.
\set ON_ERROR_STOP on

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_roles
    WHERE rolname = ANY (ARRAY['rudra_dev_migrator', 'rudra_dev_app', 'rudra_test_runner'])
  ) OR EXISTS (
    SELECT 1 FROM pg_database
    WHERE datname = ANY (ARRAY['rudra_health_dev', 'rudra_health_test'])
  ) THEN
    RAISE EXCEPTION 'A Rudra database role or database already exists; inspect it before provisioning.';
  END IF;
END
$$;

CREATE ROLE rudra_dev_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE rudra_dev_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE rudra_test_runner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;

CREATE DATABASE rudra_health_dev OWNER rudra_dev_migrator;
CREATE DATABASE rudra_health_test OWNER rudra_test_runner;

REVOKE CONNECT ON DATABASE rudra_health_dev FROM PUBLIC;
GRANT CONNECT ON DATABASE rudra_health_dev TO rudra_dev_migrator, rudra_dev_app;
REVOKE CONNECT ON DATABASE rudra_health_test FROM PUBLIC;
GRANT CONNECT ON DATABASE rudra_health_test TO rudra_test_runner;

\connect rudra_health_dev
ALTER SCHEMA public OWNER TO rudra_dev_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO rudra_dev_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rudra_dev_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO rudra_dev_app;
ALTER DEFAULT PRIVILEGES FOR ROLE rudra_dev_migrator IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO rudra_dev_app;

\connect rudra_health_test
ALTER SCHEMA public OWNER TO rudra_test_runner;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
