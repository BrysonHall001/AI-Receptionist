-- Global master-hub billing dashboards (not per-portal). One widget layout per scope.
CREATE TABLE IF NOT EXISTS "BillingDashboard" (
  "scope" TEXT NOT NULL,
  "widgets" JSONB NOT NULL DEFAULT '[]',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BillingDashboard_pkey" PRIMARY KEY ("scope")
);

-- Seed BOTH scopes with the current default widgets so neither starts empty. ON CONFLICT
-- DO NOTHING keeps any layout a human has already customized on a re-run.
INSERT INTO "BillingDashboard" ("scope", "widgets", "updatedAt")
VALUES ('tenant_drilldown', '[{"id":"bw_cost","title":"Total est. cost","source":"usage","type":"kpi","measure":{"op":"sum","field":"totalCost"},"groupBy":[],"series":[],"filters":[]},{"id":"bw_calls","title":"Calls","source":"usage","type":"kpi","measure":{"op":"sum","field":"calls"},"groupBy":[],"series":[],"filters":[]},{"id":"bw_minutes","title":"Call minutes","source":"usage","type":"kpi","measure":{"op":"sum","field":"callMinutes"},"groupBy":[],"series":[],"filters":[]},{"id":"bw_tokens","title":"Total tokens","source":"usage","type":"kpi","measure":{"op":"sum","field":"totalTokens"},"groupBy":[],"series":[],"filters":[]},{"id":"bw_emails","title":"Emails","source":"usage","type":"kpi","measure":{"op":"sum","field":"emails"},"groupBy":[],"series":[],"filters":[]},{"id":"bw_cost_ot","title":"Estimated cost over time","source":"usage","type":"line","measure":{"op":"sum","field":"totalCost"},"groupBy":[{"key":"date"}],"series":[],"filters":[]},{"id":"bw_calls_ot","title":"Calls over time","source":"usage","type":"bar","measure":{"op":"sum","field":"calls"},"groupBy":[{"key":"date"}],"series":[],"filters":[]},{"id":"bw_minutes_ot","title":"Call minutes over time","source":"usage","type":"bar","measure":{"op":"sum","field":"callMinutes"},"groupBy":[{"key":"date"}],"series":[],"filters":[]}]'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("scope") DO NOTHING;
INSERT INTO "BillingDashboard" ("scope", "widgets", "updatedAt")
VALUES ('macro', '[{"id":"bw_cost","title":"Total est. cost","source":"usage","type":"kpi","measure":{"op":"sum","field":"totalCost"},"groupBy":[],"series":[],"filters":[]},{"id":"bw_calls","title":"Calls","source":"usage","type":"kpi","measure":{"op":"sum","field":"calls"},"groupBy":[],"series":[],"filters":[]},{"id":"bw_minutes","title":"Call minutes","source":"usage","type":"kpi","measure":{"op":"sum","field":"callMinutes"},"groupBy":[],"series":[],"filters":[]},{"id":"bw_tokens","title":"Total tokens","source":"usage","type":"kpi","measure":{"op":"sum","field":"totalTokens"},"groupBy":[],"series":[],"filters":[]},{"id":"bw_emails","title":"Emails","source":"usage","type":"kpi","measure":{"op":"sum","field":"emails"},"groupBy":[],"series":[],"filters":[]},{"id":"bw_cost_ot","title":"Estimated cost over time","source":"usage","type":"line","measure":{"op":"sum","field":"totalCost"},"groupBy":[{"key":"date"}],"series":[],"filters":[]},{"id":"bw_calls_ot","title":"Calls over time","source":"usage","type":"bar","measure":{"op":"sum","field":"calls"},"groupBy":[{"key":"date"}],"series":[],"filters":[]},{"id":"bw_minutes_ot","title":"Call minutes over time","source":"usage","type":"bar","measure":{"op":"sum","field":"callMinutes"},"groupBy":[{"key":"date"}],"series":[],"filters":[]}]'::jsonb, CURRENT_TIMESTAMP)
ON CONFLICT ("scope") DO NOTHING;
