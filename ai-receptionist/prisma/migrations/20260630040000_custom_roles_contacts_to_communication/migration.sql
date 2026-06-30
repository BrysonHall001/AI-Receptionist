-- Custom-role migration (June 30, 2026): surveys/email/templates moved from the
-- `contacts.edit` gate to the `communication` area (view/edit/delete). To preserve the
-- current behavior of any custom role that was granted contacts.edit specifically to run
-- surveys / send blasts, also grant it communication view+edit+delete. Idempotent:
-- re-running is a no-op once communication is already fully granted.
UPDATE "PortalRole"
SET "permissions" = jsonb_set(
      "permissions",
      '{communication}',
      COALESCE("permissions"->'communication', '{}'::jsonb)
        || '{"view": true, "edit": true, "delete": true}'::jsonb,
      true
    )
WHERE ("permissions"->'contacts'->>'edit') = 'true'
  AND (
        COALESCE("permissions"->'communication'->>'view',   'false') <> 'true'
     OR COALESCE("permissions"->'communication'->>'edit',   'false') <> 'true'
     OR COALESCE("permissions"->'communication'->>'delete', 'false') <> 'true'
  );
