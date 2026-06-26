-- Going-forward Change Log entry (explicit work date — June 26, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_communication_email',
  '2026-06-26T00:00:00.000Z',
  'Feature',
  'New Communication page for manual outbound email: pick an audience by saved filter or live criteria (with a real-time recipient count), write a rich-text email, and send to many contacts at once.',
  'batch-communication-email-20260626',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
