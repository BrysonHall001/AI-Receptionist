-- PRICE BOOK backfill (idempotent, per the approved collision rule).
--
-- 1) Catalog source on EXISTING Estimates/Invoices line_items fields — only
--    where options is still the untouched empty array (the only value the UI
--    could ever have written for line_items until now). Any other options value
--    is owner territory and is left byte-untouched.
UPDATE "FieldDef" f
SET "options" = '{"source":{"module":"product","map":{"description":"__title","unitPrice":"price","details":"description"}}}'::jsonb
FROM "RecordType" rt
WHERE f."recordTypeId" = rt."id"
  AND rt."key" IN ('estimate','invoice')
  AND f."key" = 'line_items'
  AND f."type" = 'line_items'
  AND (f."options" IS NULL OR f."options" = '[]'::jsonb);

-- 2) Invoice completion fields on EXISTING portals — added ONLY when no field
--    with that key exists on that tenant's Invoices module (an existing same-key
--    field of ANY type is never retyped, relabeled, or reordered).
INSERT INTO "FieldDef" ("id","tenantId","recordTypeId","scope","key","label","type","required","options","order","system","createdAt","updatedAt")
SELECT gen_random_uuid()::text, rt."tenantId", rt."id", 'record', 'paid_date', 'Paid date', 'date', false, '[]'::jsonb,
       COALESCE((SELECT MAX(x."order") FROM "FieldDef" x WHERE x."recordTypeId" = rt."id"), -1) + 1,
       false, NOW(), NOW()
FROM "RecordType" rt
WHERE rt."key" = 'invoice'
  AND NOT EXISTS (SELECT 1 FROM "FieldDef" e WHERE e."recordTypeId" = rt."id" AND e."key" = 'paid_date');

INSERT INTO "FieldDef" ("id","tenantId","recordTypeId","scope","key","label","type","required","options","order","system","createdAt","updatedAt")
SELECT gen_random_uuid()::text, rt."tenantId", rt."id", 'record', 'payment_method', 'Payment method', 'single_select', false,
       '["Cash","Check","Card","Bank transfer","Other"]'::jsonb,
       COALESCE((SELECT MAX(x."order") FROM "FieldDef" x WHERE x."recordTypeId" = rt."id"), -1) + 1,
       false, NOW(), NOW()
FROM "RecordType" rt
WHERE rt."key" = 'invoice'
  AND NOT EXISTS (SELECT 1 FROM "FieldDef" e WHERE e."recordTypeId" = rt."id" AND e."key" = 'payment_method');
