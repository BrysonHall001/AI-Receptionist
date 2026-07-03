-- Move billing dashboards from one-row-per-scope to a shared SET of named dashboards.
-- Data-preserving: merge the existing macro + tenant_drilldown widgets into a single "Overview"
-- dashboard, deduped by widget id, each tagged scope "both" so nothing is lost or hidden.
-- Idempotent: only transforms when the OLD (scope-keyed) shape is present.

DO $$
DECLARE
  macro_w  jsonb := '[]'::jsonb;
  tenant_w jsonb := '[]'::jsonb;
  result   jsonb := '[]'::jsonb;
  seen     text[] := ARRAY[]::text[];
  elem     jsonb;
  wid      text;
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'BillingDashboard' AND column_name = 'scope') THEN
    SELECT COALESCE(widgets, '[]'::jsonb) INTO macro_w  FROM "BillingDashboard" WHERE scope = 'macro';
    SELECT COALESCE(widgets, '[]'::jsonb) INTO tenant_w FROM "BillingDashboard" WHERE scope = 'tenant_drilldown';
    IF macro_w  IS NULL THEN macro_w  := '[]'::jsonb; END IF;
    IF tenant_w IS NULL THEN tenant_w := '[]'::jsonb; END IF;

    -- macro widgets first (scope both), then any tenant widget not already present (by id).
    FOR elem IN SELECT value FROM jsonb_array_elements(macro_w) AS value LOOP
      wid := elem->>'id';
      IF wid IS NULL OR NOT (wid = ANY(seen)) THEN
        result := result || jsonb_build_array(elem || '{"scope":"both"}'::jsonb);
        IF wid IS NOT NULL THEN seen := array_append(seen, wid); END IF;
      END IF;
    END LOOP;
    FOR elem IN SELECT value FROM jsonb_array_elements(tenant_w) AS value LOOP
      wid := elem->>'id';
      IF wid IS NULL OR NOT (wid = ANY(seen)) THEN
        result := result || jsonb_build_array(elem || '{"scope":"both"}'::jsonb);
        IF wid IS NOT NULL THEN seen := array_append(seen, wid); END IF;
      END IF;
    END LOOP;

    ALTER TABLE "BillingDashboard" RENAME TO "BillingDashboard_old";
    ALTER TABLE "BillingDashboard_old" RENAME CONSTRAINT "BillingDashboard_pkey" TO "BillingDashboard_old_pkey";
    CREATE TABLE "BillingDashboard" (
      "id" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "widgets" JSONB NOT NULL DEFAULT '[]',
      "sortOrder" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL,
      CONSTRAINT "BillingDashboard_pkey" PRIMARY KEY ("id")
    );
    INSERT INTO "BillingDashboard" ("id", "name", "widgets", "sortOrder", "updatedAt")
    VALUES (gen_random_uuid()::text, 'Overview', result, 0, CURRENT_TIMESTAMP);

    DROP TABLE "BillingDashboard_old";
  END IF;
END $$;

-- Safety net for a fresh DB (no prior scope table): ensure the new shape exists.
CREATE TABLE IF NOT EXISTS "BillingDashboard" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "widgets" JSONB NOT NULL DEFAULT '[]',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingDashboard_pkey" PRIMARY KEY ("id")
);
