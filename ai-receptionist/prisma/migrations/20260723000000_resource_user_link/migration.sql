-- Work Orders foundation: optional Resource -> User link.
-- Purely additive: nullable column + index + FK (SET NULL so deleting a user can
-- never leave a dangling link). No backfill; unlinked resources behave as before.
ALTER TABLE "Resource" ADD COLUMN "userId" TEXT;

CREATE INDEX "Resource_tenantId_userId_idx" ON "Resource"("tenantId", "userId");

ALTER TABLE "Resource" ADD CONSTRAINT "Resource_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
