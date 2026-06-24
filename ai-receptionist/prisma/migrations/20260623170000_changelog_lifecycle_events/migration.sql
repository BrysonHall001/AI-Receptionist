-- Going-forward Change Log entry for the lifecycle-events batch (data only, no
-- schema change — Event.type is a free-text column, so the new types need no enum
-- migration). Applies via Render's Pre-Deploy migrate; ON CONFLICT keeps it safe
-- if ever re-applied.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_lifecycle_events',
  '2026-06-23T00:00:00.000Z',
  'Feature',
  'The Automations event log now records when a record (e.g. a Job) is created, when a contact or record is deleted, and when one is restored from the Recycle Bin — each attributed to the person, automation, or sync that did it. Creating a booking still shows a single entry, not two.',
  'lifecycle-create-delete-restore-events',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
