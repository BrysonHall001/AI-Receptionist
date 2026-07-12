-- Going-forward Change Log entry: three small Modules & Fields fixes. Idempotent.
-- (Folder timestamped after this day's earlier migrations to preserve apply order; the
--  suggested id/commitSha/type are kept.)
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_mf_fixes_20260712',
  '2026-07-12',
  'Fix',
  'Three fixes on Settings, Modules & Fields. (1) Creating a module with "+ Add module" now makes it appear in the left sidebar nav immediately, with no page reload - the create step refreshes the record-type list the nav is built from (previously it only refreshed labels, so a brand-new module stayed missing from the sidebar until a reload). (2) The Views panel''s "Board" tile now becomes available the moment a module''s pipeline is turned on: its availability keys off the same Pipeline on/off flag as the Structure & behavior toggle (not off whether types/stages exist yet), and the panel repaints live off the fresh setting when you flip the toggle, so Board switches between available and unavailable without a reload or a stale read. (3) The Modules & Fields columns were rebalanced so the Field library is wider (roughly matching the Fields column) and the field-type tiles now wrap only between whole words instead of breaking mid-word ("Currency", "Number", "Auto-number" no longer split). No schema change and no change to nav ordering, other modules'' Views tiles, the Structure & behavior editors, or the pipeline toggle''s non-destructive behavior.',
  'batch-mf-fixes-20260712',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
