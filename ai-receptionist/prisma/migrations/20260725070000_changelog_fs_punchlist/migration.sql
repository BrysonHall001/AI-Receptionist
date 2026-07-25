-- Changelog: Field-services punch list 1 (Board view, walkthrough fixes, storage visibility, Work Orders on by default)
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_fs_punchlist_1_20260725',
  '2026-07-25',
  'Improvement',
  'Seven fixes from the first hands-on field-services walkthrough. The big one: the Board view is now real on module list pages — a kanban with one column per status, where dragging a card between columns updates the record''s status through the same path as editing it by hand (permissions, history, and automations all behave identically, with an Undo on the confirmation). It works for any module with statuses and the Board view turned on. Work Orders now shows off out of the box: Board, Calendar (with staff lanes and the unscheduled tray), and Map are on by default for new portals, and existing portals gain any views they were missing without touching choices their owner already made. Also fixed: raw "not found" messages replaced with friendly pages, the Calendar tile''s sub-options restyled to match the app''s switches, leftover recruiting wording removed from module settings, a File Storage card added to Settings > Integrations showing whether cloud storage is active, and an object-storage reachability check added to the system Health page. A short "get set up" checklist now greets an empty Work Orders page.',
  'batch-fs-punchlist-1-20260725',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
