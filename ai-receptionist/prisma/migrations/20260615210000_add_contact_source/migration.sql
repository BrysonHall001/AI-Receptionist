-- Contact "source": records HOW a contact first entered the system.
--
-- ADDITIVE ONLY: one new column with a safe default. No existing data is
-- deleted or rewritten. The column is set server-side at creation time
-- (phone / manual / webhook / import / automation / dummy) and is NEVER
-- overwritten on update, so it means "how the contact first entered".

-- 1) Add the column. Every existing row gets 'unknown' automatically.
ALTER TABLE "Contact" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'unknown';

-- 2) Evidence-based backfill: any existing contact that PROVABLY had a call
--    (it has at least one linked CallSession) is marked 'phone'. Everything
--    else stays 'unknown'. We never guess from a phone number alone, because
--    imported/manual contacts can have phone numbers too.
UPDATE "Contact" SET "source" = 'phone'
  WHERE "id" IN (SELECT DISTINCT "contactId" FROM "CallSession" WHERE "contactId" IS NOT NULL);
