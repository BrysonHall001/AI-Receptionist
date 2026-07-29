-- Changelog: service plans
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_service_plans_20260728',
  '2026-07-28',
  'Feature',
  'Service Plans have arrived for field-service portals: the maintenance memberships you sell — "two tune-ups a year plus priority scheduling, £29 a month" — are now a proper record rather than something faked with a repeating job. A plan holds what the customer gets, what it costs, how often it bills, when it starts and when it renews, and it can be Active, Paused, Cancelled or Expired. The plan owns its schedule: tell it a visit is due every so many months and, when one falls due, it creates an ordinary work order with no date on it, so the job lands in your unscheduled tray to be dispatched exactly like every other. The visit carries the customer and a description; it never carries the price, and it never turns into a repeating job of its own. Pausing, cancelling or expiring a plan stops it creating anything at once. You can link the equipment a plan covers, and each unit then shows which plan covers it. Renewal dates roll forward by themselves on the billing cadence and the plan stays active, and there is a new opt-in automation in the library that reminds you a fortnight before a renewal — switched off until you want it. When a billing period comes round, one button on the plan writes an ordinary unpaid invoice with the plan''s price as a line item, linked back to the plan; pressing it twice in the same period opens the invoice you already made rather than creating a second. To be plain about what this is not: Clarity records the agreement and writes the invoice, but it does not take payment and there is no card processing in it — collect however you already do. Service Plans appear for Field Services portals; General and Recruitment Marketing portals are unaffected.',
  'batch-service-plans-20260728',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
