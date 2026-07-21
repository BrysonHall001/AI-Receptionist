-- Changelog: Developer Tools batch 2 — the audit foundation
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_audit_foundation_20260717',
  '2026-07-17',
  'Improvement',
  'Groundwork for the upcoming Audit Log: the app now keeps a quiet, comprehensive record of every meaningful action — who did what, when, and to which record, including field-level before-and-after values for edits. Coverage spans record and contact changes (human, automation, and AI-receptionist alike), imports and exports with row counts, bulk updates, structure changes in Modules & Fields, settings changes across appearance, AI, integrations, permissions and scheduling, sign-ins and sign-outs (with failed attempts), admin session-assumption, automation executions, and admin workspace management. Capture is engineered to be invisible: it can never slow, block, or fail the action it records, message contents and passwords are never stored, and entries name their actor permanently even if that user is later removed. History follows a strict retention policy — after 14 days entries are queued for deletion and purged 14 days later, trimmed continuously in small batches. The viewer arrives in the next batch under Developer Tools.',
  'batch-audit-foundation-20260717',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
