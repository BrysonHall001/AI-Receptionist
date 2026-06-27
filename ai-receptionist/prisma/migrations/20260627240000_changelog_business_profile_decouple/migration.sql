-- Going-forward Change Log entry (explicit work date — June 27, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_business_profile_decouple',
  '2026-06-27T00:00:00.000Z',
  'Change',
  'Settings → General is now "Business Profile" (business name + notify email only). The receptionist''s greeting and business description now come solely from the Calls-page instructions — removed the separate Greeting and Business Type fields and the duplicate Phone Number (still set under Integrations) so there''s a single source of truth for receptionist behavior. Calling is unaffected.',
  'batch-business-profile-decouple-20260627',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
