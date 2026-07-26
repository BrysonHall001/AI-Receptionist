-- Changelog: tenant templates 2 (Field Services content pack)
INSERT INTO "ChangeLogEntry" ("id","date","type","description","commitSha","createdAt")
VALUES (
  'cl_tenant_templates_2_20260725',
  '2026-07-25',
  'Feature',
  'Field Services tenants now start furnished. A new one arrives with its Home dashboard already useful — new requests, today''s schedule, jobs by status, and what''s been invoiced — plus three ready-made Analytics dashboards (Operations, Revenue, Customers & Calls) built from ordinary widgets you can edit or delete. The automation library sorts itself for the trade: the most relevant recipes surface first (visit reminders, request acknowledgments, review asks, equipment service reminders), every generic recipe stays exactly where it was, and two new entries join the shelf — an unpaid-invoice reminder and an estimate-still-undecided nudge, both applying as disabled drafts you enable when ready. Communication gets three draft email templates (visit confirmation, estimate follow-up, thanks after completion) and a short post-visit survey in draft. And the AI receptionist''s Instructions gain one starter section — Industry context — a short scaffold you edit with what you do, where you work, and what counts as an emergency. Everything is plain data on your existing pages; nothing sends, fires, or changes behavior until you turn it on. Work orders also joined bookings as fully reportable with appointment date and staff, for every workspace.',
  'batch-tenant-templates-2-20260725',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
