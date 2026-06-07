PART 1: Field sections + two-column profile layout (+ Part 2 dropdown change)
=============================================================================
Unzip at the project ROOT. THIS BATCH NEEDS A ONE-TIME MIGRATION — see chat for
the exact command. The migration is additive and safe (new table + one nullable
column); every existing field keeps its key, its values, and renders as before.

Files:
  prisma/schema.prisma                                  + FieldSection model, FieldDef.sectionId
  prisma/migrations/20260607010000_field_sections/...   the migration SQL
  src/services/fieldSectionService.ts   NEW  sections: list/create/rename/reorder/delete
  src/services/fieldService.ts          serialize sectionId + setFieldSection (display-only)
  src/routes/api.ts                      /field-sections routes + /fields/:id/section
  public/js/fields.js                    grouped two-column editor (renderGroupedEditor)
  public/js/portal.js                    Fields-page section mgmt; grouped contact+job detail
                                         (also includes the Part 2 candidate dropdown change)
  public/styles.css                      two-column grid + section styles

Section assignment is DISPLAY metadata only — it never changes a field's key,
its stored values, or how automations/reports/filters reference it. Fields with
no section render under "Ungrouped" so nothing disappears.
