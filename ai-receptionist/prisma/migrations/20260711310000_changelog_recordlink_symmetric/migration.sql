-- Going-forward Change Log entry: symmetric record links. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_recordlink_symmetric_20260708',
  '2026-07-11',
  'Improvement',
  'Behind-the-scenes foundation change: record links were generalized from a one-directional, Contact-centric parent-to-child model into a symmetric any-record-to-any-record model. A link now represents a relationship between two endpoints (a record and a contact, or two records) and can be found from either side, while keeping all of its context exactly as before — the relationship stage, role, custom fields, and full stage history are unchanged in meaning. Nothing changes for users in this release: the Contact page keeps showing linked Jobs (with stage movement) and Equipment, bookings still link their contact, and every existing link continues to work identically. Existing links were preserved as-is (no data was moved or altered). The user-facing relationship field that lets you link any two records comes in the next batch.',
  'batch-recordlink-symmetric-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
