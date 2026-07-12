-- Going-forward Change Log entry: generalized Related tabs + three new field types. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_related_tabs_field_types_20260708',
  '2026-07-11',
  'Feature',
  'Two independent improvements. (A) The tabbed "Related" area — one tab per other module, each with link-existing search, create-new-and-link, and a List/Board (kanban) toggle where that module has a pipeline — now appears on EVERY record detail page, not just Contacts. Opening a Job, Booking, Equipment, Vehicle, Property, Product, Estimate, Task, or any custom module shows a Related area with a tab for every other module (including a Contacts tab), driven by the record-type registry and the existing symmetric record-links, so a link made from any side shows on both records. A record never shows a tab for its own type, tabs are relabel-aware and scroll on narrow screens, and the Contact page is unchanged. (B) Three new field types are available everywhere fields are used (field editor, record create/edit forms, list display, import/export, backup): Auto-number, which assigns a unique sequential value to each record in its module when the record is saved, with an optional prefix and zero-padding set in the field''s Edit dialog (for example INV-0001) — assigned atomically so concurrent creates never skip or duplicate, and a value supplied on import is kept as a back-number; Color, a hex colour with a swatch/picker that shows as a small colour chip; and Progress, a 0-100 value shown as an editable bar with its percentage that aggregates and averages like a number in analytics. Out-of-range progress values are clamped to 0-100. No breaking changes to existing field types.',
  'batch-related-tabs-field-types-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
