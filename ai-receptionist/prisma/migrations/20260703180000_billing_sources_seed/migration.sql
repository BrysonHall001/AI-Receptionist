-- Seed the shared "Overview" dashboard with two macro-scoped portfolio widgets that reproduce
-- the retired "By portal" tab: a table + a cost-by-portal bar. Idempotent + non-destructive
-- (guards on widget id; never wipes existing widgets).
DO $$
DECLARE
  did text;
  ws  jsonb;
  w1  jsonb := '{"id":"bw_portfolio_table","title":"By portal","source":"portfolio","type":"list","scope":"macro","columns":["tenant","billingStatus","calls","callMinutes","totalTokens","emails","estCost","billed","paid","outstanding"],"measure":{"op":"count"},"groupBy":[],"series":[],"filters":[],"cw":4,"ch":"m"}'::jsonb;
  w2  jsonb := '{"id":"bw_cost_by_portal","title":"Estimated cost by portal","source":"portfolio","type":"bar","scope":"macro","measure":{"op":"sum","field":"estCost"},"groupBy":[{"key":"tenant"}],"series":[],"filters":[],"cw":2,"ch":"m"}'::jsonb;
BEGIN
  SELECT id, widgets INTO did, ws FROM "BillingDashboard" WHERE name = 'Overview' ORDER BY "sortOrder" ASC LIMIT 1;
  IF did IS NULL THEN
    SELECT id, widgets INTO did, ws FROM "BillingDashboard" ORDER BY "sortOrder" ASC LIMIT 1;
  END IF;
  IF did IS NULL THEN
    INSERT INTO "BillingDashboard" ("id", "name", "widgets", "sortOrder", "updatedAt")
    VALUES (gen_random_uuid()::text, 'Overview', jsonb_build_array(w1, w2), 0, CURRENT_TIMESTAMP);
    RETURN;
  END IF;
  IF ws IS NULL THEN ws := '[]'::jsonb; END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(ws) e WHERE e->>'id' = 'bw_portfolio_table') THEN
    ws := ws || jsonb_build_array(w1);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM jsonb_array_elements(ws) e WHERE e->>'id' = 'bw_cost_by_portal') THEN
    ws := ws || jsonb_build_array(w2);
  END IF;
  UPDATE "BillingDashboard" SET widgets = ws, "updatedAt" = CURRENT_TIMESTAMP WHERE id = did;
END $$;
