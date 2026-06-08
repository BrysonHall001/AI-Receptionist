Batch 1a — Records backbone (schema + backfill ONLY)
=====================================================
Unzip at the ROOT of your project (the folder with src/ and public/).

** THIS BATCH INCLUDES A DATABASE MIGRATION WITH A BACKFILL ** — see the chat
for the exact, ordered commands (restore point first, your click to run it).

Files in this zip:
  prisma/schema.prisma                                         + RecordType, Record, RecordLink; FieldDef gains recordTypeId + scope
  prisma/migrations/20260606210000_records_backbone/migration.sql  the migration (tables + FieldDef change + backfill, in one shot)
  src/services/recordTypeService.ts                            ensures each portal's system "contact" record type
  src/services/fieldService.ts                                 ties fields to a record type (keeps "add field" working)
  src/services/contactService.ts                               orphan cleanup: deleting a contact soft-deletes its record links

WHAT'S NEW (invisible to users in this batch):
- Three tables that let the CRM hold object types beyond contacts (Jobs,
  Policies, Work-orders) and relate them to contacts MANY-to-MANY, with the
  stage living on the relationship (plus an optional record-level status).
- A system "contact" record type per portal, and existing custom fields pointed
  at it (so "Contact" can be relabelled per portal later without breaking keys).

NOT in this batch (by design): no Jobs/records screens, no kanban, no Fields-page
changes, no automation/engine changes. Those are 1b / Batch 2.

See the chat for the ordered commands, the revert, and confirmations.
