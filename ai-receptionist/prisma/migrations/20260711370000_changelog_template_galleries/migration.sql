-- Going-forward Change Log entry: template galleries reorganized + new module templates. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_template_galleries_20260708',
  '2026-07-11',
  'Feature',
  'Reorganized both template galleries into left-side category tabs and added ready-made templates for the pre-built modules. The Analytics "Report templates" modal and the Automations "Automation templates" modal now show their categories as a list down the left side; clicking a category shows just that category''s templates on the right, instead of one long scroll (on narrow screens the categories collapse to a horizontal row). New analytics report templates slot into the existing functional categories (Volume & activity, Conversion & pipeline, Breakdowns, Trends over time) — not per-module categories — and only appear when the matching module exists in the portal: Estimates by status, Estimate value over time, and Estimates expiring soon; Tasks by status and Open tasks by priority (excluding Done); Vehicles by type; Properties by status; and Products by category. The existing Equipment report templates were folded into those same functional categories for consistency, and the standalone "Equipment" report category was retired. New automation templates land in the Follow-ups category and apply as inactive drafts like the others: an Estimate expiring reminder (a week before an estimate''s valid-until date), a Task due-soon reminder (a couple of days before a task''s due date), and an Overdue task alert (the day after a task''s due date, only for tasks not marked Done). A Vehicle/Property service follow-up was intentionally not added because those modules have no suitable date field to trigger on. Internal-only template metadata is still stripped from what the browser receives. No schema changes.',
  'batch-template-galleries-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
