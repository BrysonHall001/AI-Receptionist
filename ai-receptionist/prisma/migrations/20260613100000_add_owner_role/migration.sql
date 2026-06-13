-- Add the OWNER tier ABOVE SUPER_ADMIN in the Role enum.
--
-- This migration ONLY adds the new enum value; it does not use it anywhere (no
-- row is set to OWNER here). Splitting "add the value" from "use the value" is
-- deliberate: Postgres will not let you add an enum value and use it in the same
-- transaction, so the actual OWNER assignment is a separate manual step run
-- AFTER this migration is applied (see scripts/db makeOwner).
--
-- BEFORE 'SUPER_ADMIN' keeps the database enum order matching schema.prisma.
ALTER TYPE "Role" ADD VALUE 'OWNER' BEFORE 'SUPER_ADMIN';
