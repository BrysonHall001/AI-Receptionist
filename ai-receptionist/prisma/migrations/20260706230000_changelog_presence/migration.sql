-- Going-forward Change Log entry: who's-online presence dots (data only). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_presence_who_is_online_20260706',
  '2026-07-06',
  'Feature',
  'Added a "who''s online" presence indicator to the portal top bar: small colored avatar dots (one per portal member currently active in that portal), each showing the member''s initial, with a "+N" chip when there are many. Presence is strictly per-portal and shows only display name, initial and color — no email or other details. Only real portal members (Portal Admins and Client Users, including custom-role users) ever appear; Owners, Super Admins and Auditors are never shown, including while impersonating a member. You also see your own dot. Members can pick a personal dot color in Settings → Your account (with a live preview); until chosen, a stable color is auto-assigned. Dots update as people come and go and pause while your tab is hidden.',
  'batch-presence-who-is-online-20260706',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
