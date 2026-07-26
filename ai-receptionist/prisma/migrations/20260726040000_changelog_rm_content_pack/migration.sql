-- Changelog: RM-2 — chip visibility fix + Recruitment Marketing content pack
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_rm_content_pack_20260726',
  '2026-07-26',
  'Feature',
  'Pick Recruitment Marketing when you create a workspace and it now arrives furnished. The home dashboard opens with five recruiter widgets — new candidates this week, candidates by source (the ad-channel lens), interviews, a pipeline snapshot, and hires. Analytics carries three ready-made dashboards: "Candidate pipeline", "Where candidates come from" (including a source-by-stage grid and hires-by-source, the ad-ROI view), and "Interviews & calls". The automation library leads with recruiting recipes — a welcome for every new candidate, day-before and two-hour interview reminders, a stale-candidate nudge, a submitted-to-client alert, and a post-interview follow-up — each one an ordinary disabled draft you can read, edit, or delete, with every generic recipe still exactly where it was. Three email drafts and a candidate-experience survey wait in Communication, unsent, and the AI receptionist gets a short editable Recruiting context section covering what you hire for, how interviews get booked, and what never to promise. Nothing switches itself on, and no other workspace is touched. Also: on the create screen, a module row now shows its field chips only while that module is actually checked — check one back on and its chips reappear instantly.',
  'batch-rm-content-pack-20260726',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
