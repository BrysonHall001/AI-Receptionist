-- Add the AUDITOR role (temporary tester accounts).
--
-- Add-only, exactly like the OWNER migration: this statement adds the enum value
-- but never uses it, so it deploys cleanly. Any account is set to AUDITOR through
-- normal user creation AFTER this migration is applied.
ALTER TYPE "Role" ADD VALUE 'AUDITOR';
