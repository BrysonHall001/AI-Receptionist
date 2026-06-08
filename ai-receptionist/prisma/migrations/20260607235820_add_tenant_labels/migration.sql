-- AlterTable
ALTER TABLE "Tenant" ADD COLUMN     "labels" JSONB NOT NULL DEFAULT '{}';
