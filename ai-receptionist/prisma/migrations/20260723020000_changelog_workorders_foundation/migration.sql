-- Changelog: Work Orders foundation
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_workorders_foundation_20260723',
  '2026-07-23',
  'Feature',
  'Clarity now has a Work Orders module built for field service. Every workspace gets it automatically: a work order carries a description, priority, service address, photos, and internal notes, moves through New request, Scheduled, In progress, Completed, and Cancelled, and can be typed as a Repair, Maintenance, Installation, or Inspection (all renamable, like any module). Give a work order a scheduled window and it appears on the module''s calendar; give it a service address and it lands as a pin on the map. Work orders can be assigned to a staff member from the same staff list bookings use, and a staff member can now be linked to their sign-in account, which unlocks a one-click "My work orders" filter showing each person exactly the work assigned to them. Status changes on work orders fire automations the same way other records do, so follow-ups can be automated from day one. Alongside this, the recruiting module formerly called "Jobs" is now "Job Openings" so it reads as what it is — a hiring pipeline — with nothing but the name changing, and only in workspaces that had not already renamed it. Bookings, availability, and Google Calendar sync are completely untouched.',
  'batch-workorders-foundation-20260723',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
