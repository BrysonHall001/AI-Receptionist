-- Going-forward Change Log entry: Calls restored to nav, collapse centering + full-screen
-- padding, Fields column independent scroll, Address/Rating/Duration field types, and the
-- All-tenants block relocated. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_calls_fields_layout_20260708',
  '2026-07-11',
  'Feature',
  'Portal layout and field-type updates. The Calls page is back in the top pages row, directly to the right of Home Dashboard (it had dropped out during the layout restructures); it still routes to the Calls page and keeps its rename/reorder/hide menu. The collapse (hamburger) icon at the far-left of the pages row is now vertically centered with the page tabs, and when you collapse into full-screen the content no longer sits flush against the title — it gets sensible top/left padding. On Modules & Fields, the center Fields column now scrolls on its own: its height is tied to the viewport so scrolling while hovering it moves only that column, leaving the Field library, Terms, and the rest of the page in place. Three new field types were added — Address (structured street/city/state/postal/country, shown as a single readable line), Rating (1-5 stars, stored as an integer and summable in reports like a number), and Duration (entered as hours/minutes, stored as whole minutes and shown as e.g. "1h 30m"). All three appear in the Field library and the "+ Add field" type picker and work in the field editor, record forms, list columns, and import/export. Finally, for admin-tier users viewing a portal, the "back to All tenants" link and portal name moved from beside the logo to the bottom of the left column, right-aligned, just above the divider over the user chip. No changes to existing field data or keys.',
  'batch-calls-fields-layout-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
