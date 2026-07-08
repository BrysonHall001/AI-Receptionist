-- Going-forward Change Log entry: Analytics on-ramp polish (data only). Idempotent.
INSERT INTO "ChangeLogEntry" ("id", "date", "type", "description", "commitSha", "createdAt")
VALUES (
  'cl_report_onramp_polish_20260707',
  '2026-07-07',
  'Fix',
  'Polished the Analytics widget on-ramps. The two entry cards ("Start from a template" and "Build with a wizard") now show their caption on its own line beneath the title, matching the Automations cards. The report template gallery and the wizard now respect your custom labels: template titles and descriptions, the data-source choices, and the name of the widget a template or wizard creates all use your renamed nouns (e.g. a portal that renamed Contacts sees its own word everywhere). The Automations template gallery was made consistent so its template titles/descriptions relabel the same set of nouns too.',
  'batch-report-onramp-polish-20260707',
  NOW()
)
ON CONFLICT ("commitSha") DO NOTHING;
