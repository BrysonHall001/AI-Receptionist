-- Going-forward Change Log entry (explicit work date — June 25, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_role_assignment',
  '2026-06-25T00:00:00.000Z',
  'Feature',
  'You can now put users into custom roles, completing the permissions feature. In Settings → Team & Permissions, the invite dropdown and each member''s role now list the portal''s custom roles alongside Client User and Portal Admin; assigning one makes that user''s access come from the role''s grid. Safeguards hold server-side: a portal admin can''t change or affect a super-admin, and can''t promote anyone above what they''re allowed to grant. If a custom role is deleted while people are assigned to it, they are safely moved to Client User (the most restricted role) — the panel shows how many will be reassigned before you confirm. Per-user one-off overrides were intentionally left out to keep the screen clean; role-based assignment is the mechanism.',
  'role-assignment-batch5',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
