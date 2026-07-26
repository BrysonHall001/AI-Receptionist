-- Changelog: Recruitment Marketing template (RM-1) + backsplash removal
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_rm_template_1_20260726',
  '2026-07-26',
  'Feature',
  'A third starting point when creating a workspace: Recruitment Marketing, built for turning ad clicks into hired candidates. Pick it and the workspace opens with just the recruiting spine — Candidates (contacts, relabeled, carrying source, role interest, a marketing-funnel stage, prescreen checks, resume and LinkedIn links, desired pay, and availability), Job Openings (with department, location, work mode, employment type, pay range, openings count, client, ad campaign, and target start date), and Interviews — the appointments module, renamed to what it holds, where the AI receptionist books candidates natively. Service-request intake stays off (that''s a trades thing), every page stays available, and all of it — labels and fields alike — remains ordinary and editable afterward. The create screen shows the whole effect live the moment you click the card (a new handshake icon marks it), including the exact field chips each module will start with; and a small fix ships with it so switching between template cards always repaints those chips cleanly. Also: the photo texture behind the template cards was removed — the cards are cleaner without it, and nothing else about them changed.',
  'batch-rm-template-1-20260726',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
