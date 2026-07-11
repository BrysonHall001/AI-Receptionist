-- Going-forward Change Log entry: portal layout refinements. Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_portal_layout_refinements_20260708',
  '2026-07-11',
  'UI',
  'Three portal layout refinements. The "A Vaala product" tagline now sits directly above the thin divider line in the bottom-left area (just above the user chip) instead of below it. For owners/super-admins/auditors viewing a portal, the "← All tenants" link and the portal name now sit stacked to the RIGHT of the Clarity logo, top-aligned with it (a 2×2 arrangement: logo on the left spanning both rows, "← All tenants" top-right, portal name directly beneath), instead of wrapping underneath the logo. And every portal page and module now shows one consistent, left-aligned page/module title at the top of the content area — using the same (relabel-aware) name as the navigation — replacing the previous mix where only a few pages drew their own heading; the duplicate built-in headings on Automations, the Learning Center and portal Feedback were removed so the title never appears twice. Settings sub-headings and the master-hub layout are unchanged. No change to permissions or data.',
  'batch-portal-layout-refinements-20260708',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
