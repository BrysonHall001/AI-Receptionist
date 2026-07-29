-- Changelog: route awareness
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_route_awareness_20260729',
  '2026-07-29',
  'Feature',
  'The dispatch board has stopped pretending your technicians can teleport. Where a job''s address has been located on a map, the board now shows roughly how long the drive is between one job and the next in a technician''s day, and totals up their driving beside their name. When the next job starts sooner than the drive allows, the line turns amber and says so — and if you drag a job into a slot that cannot work, you get a note explaining which two jobs are too far apart, after the change has already saved. Nothing is ever blocked: every drag, drop and save behaves exactly as it did before, because a dispatcher knows things the software does not — a technician already nearby, a job that will finish early, a customer who moved the appointment. Be clear about what these numbers are. Clarity measures the straight line between two places, adds a bit because roads bend, and assumes an ordinary mixed-driving speed. It does not know about traffic, roadworks, one-way systems or bridges, and it never asks a mapping service for a route, so this costs nothing to run. The estimates are good for spotting a day that simply cannot happen and poor for telling anyone when they will arrive — every place they appear says "estimated". Where an address has not been located yet, nothing is shown at all rather than a guess, so a board with no located addresses looks exactly as it did before.',
  'batch-route-awareness-20260729',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
