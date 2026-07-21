-- Changelog: audit tab fixes + System Health
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_audit_fixes_health_20260718',
  '2026-07-18',
  'Improvement',
  'The Audit Log got a round of polish from review, and the platform learned to watch its own vital signs. In the Audit Log: the filter row now lines up perfectly with the table beneath it — fixed at the root with a shared alignment rule, so this whole class of crooked-toolbar bug is gone for good, everywhere; the Actor column became two clearer ones, User (just the name) and User Type, which shows exactly who acted — Owner, Super Admin, Auditor, Portal admin, a custom role by its own name, the AI receptionist, an automation, or the system — captured with each new event from now on; the two date boxes merged into one simple Date range picker (All time, Today, Last 7 or 14 days, or Custom); an Export button now sits beside Manage columns, using the same export dialog as everywhere else, honoring your filters, with CSV or Excel and export history; and the Details column reads cleaner, never repeating what other columns already say. New under Developer Tools: System Health — one screen of status cards covering external services (phone, AI, voice, maps, calendar), the database and app process, background work (the scheduler, geocoding, audit retention, automations, drips), and a 24-hour pulse including failed sign-ins. Checks run automatically every few minutes, a Re-check now button gets fresh answers, and when anything needs attention a small colored dot appears on the Developer Tools menu item — so problems wave at you before anyone has to go looking.',
  'batch-audit-fixes-health-20260718',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
