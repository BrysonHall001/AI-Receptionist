-- Changelog: RM-3 — the Recruitment Marketing Learning Center variant
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_lc_recruitment_20260726',
  '2026-07-26',
  'Feature',
  'Recruitment workspaces now get their own Learning Center, written for recruiters rather than adapted from generic help. It opens with your home dashboard explained tile by tile, then a guide for each of your modules — Candidates (what every field is for and how the funnel stages read), Job Openings (the role details clients ask about, and the campaign that feeds each one), and Interviews (booking, interviewers, the calendar). Four workflow guides join them up: From ad click to candidate walks the whole journey as a step-through picture — the form on your landing page, the candidate appearing already tagged with where they came from, and the nurture taking over; then Nurturing candidates, Booking interviews, and Reporting to your client. A receptionist guide covers what it knows and what it will never promise a candidate. Everything the standard manual already says well is reused as-is, so there is one source of truth per topic, and every picture is a live miniature of the real screen drawn in your own theme. Workspaces that did not ask for a custom Learning Center — and every existing workspace — see exactly the manual they saw before.',
  'batch-lc-recruitment-20260726',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
