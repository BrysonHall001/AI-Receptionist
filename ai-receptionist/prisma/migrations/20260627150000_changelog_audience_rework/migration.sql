-- Going-forward Change Log entry (explicit work date — June 27, 2026).
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_audience_rework',
  '2026-06-27T00:00:00.000Z',
  'Feature',
  'The email Audience section is now its own panel — type individual email addresses to include, build criteria with a full paginated contacts-table preview, see a live recipient/emailable count at the top, and exclude specific people before sending. Typed addresses are de-duplicated against the matched contacts.',
  'batch-audience-rework-20260627',
  CURRENT_TIMESTAMP
)
ON CONFLICT ("commitSha") DO NOTHING;
