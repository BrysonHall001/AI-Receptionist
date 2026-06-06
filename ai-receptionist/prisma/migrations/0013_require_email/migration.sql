-- AlterTable: per-CRM toggle for "email is required + unique on every contact".
-- Defaults ON (true). Turn OFF for phone-first verticals where email is optional.
ALTER TABLE "Tenant" ADD COLUMN "requireEmail" BOOLEAN NOT NULL DEFAULT true;
